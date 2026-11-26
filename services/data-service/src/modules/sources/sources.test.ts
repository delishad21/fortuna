import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CreateEntrySchema, ExternalIdSchema } from "../transactions/assistant-entries";
import {
  parseExternalId,
  pickSource,
  scoreChannelPair,
  SourceInputSchema,
  suggestSources,
  watchList,
  type SourceRow,
} from "./sources";

const NOTIF = "notif:sg.com.transitlink:0|sg.com.transitlink|7|null|10213:1764131700000";

describe("externalId schemes", () => {
  it("takes an email's Message-ID with or without angle brackets as one id", () => {
    assert.deepEqual(parseExternalId("email:<CAF7xk2Qp9@mail.gmail.com>"), {
      kind: "email",
      externalId: "email:CAF7xk2Qp9@mail.gmail.com",
      messageId: "CAF7xk2Qp9@mail.gmail.com",
    });
    assert.equal(ExternalIdSchema.parse(" email:CAF7xk2Qp9@mail.gmail.com "), "email:CAF7xk2Qp9@mail.gmail.com");
  });

  it("splits a notification id into package, key and post time", () => {
    const parsed = parseExternalId(NOTIF);
    assert.equal(parsed.kind, "notification");
    if (parsed.kind !== "notification") return;
    assert.equal(parsed.package, "sg.com.transitlink");
    assert.equal(parsed.key, "0|sg.com.transitlink|7|null|10213");
    assert.equal(parsed.postTime, 1764131700000);
    // A key with colons in its tag still parses: the post time is the last part.
    const tagged = parseExternalId("notif:com.bank.app:0|com.bank.app|1|tx:42|10001:1764131700123");
    assert.equal(tagged.kind === "notification" && tagged.key, "0|com.bank.app|1|tx:42|10001");
  });

  it("refuses ids that break their scheme and passes others unchanged", () => {
    for (const bad of [
      "email:",
      "email:no-at-sign",
      "email:<two words@host>",
      "Email:abc@host",
      "notif:sg.com.transitlink:key",
      "notif:sg.com.transitlink:key:1764131700",
      "notif:not a package:key:1764131700000",
      "notif:sg.com.transitlink::1764131700000",
    ])
      assert.equal(ExternalIdSchema.safeParse(bad).success, false, bad);
    assert.equal(ExternalIdSchema.parse("receipt-2026-11-26-1"), "receipt-2026-11-26-1");
    const entry = CreateEntrySchema.safeParse({ externalId: "notif:x", date: "2026-11-26", description: "A", amountOut: 1 });
    assert.equal(entry.success, false);
    assert.match(JSON.stringify(entry.error?.issues), /notif:<package>:<key>:<postTime>/);
  });
});

describe("source input", () => {
  it("checks senders against the kind", () => {
    const email = SourceInputSchema.parse({ kind: "email", accountId: "a", senders: ["PayLah.Alert@dbs.com", "paylah.alert@dbs.com"] });
    assert.deepEqual(email.senders, ["paylah.alert@dbs.com"]);
    assert.equal(email.channel, undefined);
    assert.equal(SourceInputSchema.safeParse({ kind: "email", accountId: "a", senders: ["sg.com.transitlink"] }).success, false);
    assert.equal(SourceInputSchema.safeParse({ kind: "notification", accountId: "a", senders: ["alerts@dbs.com"] }).success, false);
    assert.equal(SourceInputSchema.safeParse({ kind: "notification", senders: ["sg.com.transitlink"] }).success, false);
    assert.equal(SourceInputSchema.safeParse({ kind: "notification", accountId: "a", senders: [] }).success, false);
  });
});

const source = (overrides: Partial<SourceRow>): SourceRow => ({
  id: "s",
  accountId: "acc",
  cardId: null,
  kind: "notification",
  name: null,
  senders: ["com.bank.app"],
  subjectPatterns: [],
  textPatterns: [],
  identifiers: [],
  channel: "main",
  enabled: true,
  notes: null,
  ...overrides,
});

describe("picking a message's source", () => {
  it("matches the package or sender, and narrows by card, then identifiers", () => {
    const one = source({ id: "one", cardId: "c1", identifiers: ["ending 1111"] });
    const two = source({ id: "two", cardId: "c2", identifiers: ["ending 2222"] });
    const off = source({ id: "off", senders: ["com.other.app"], enabled: false });
    const all = [one, two, off];
    assert.equal(pickSource(all, { kind: "notification", sender: "com.other.app", text: "" }), null);
    assert.equal(pickSource(all, { kind: "notification", sender: "com.bank.app", text: "spent" }), null);
    assert.equal(pickSource(all, { kind: "notification", sender: "com.bank.app", text: "", cardId: "c2" })?.id, "two");
    assert.equal(pickSource(all, { kind: "notification", sender: "com.bank.app", text: "Card ENDING 1111 used" })?.id, "one");
    const mail = source({ id: "mail", kind: "email", senders: ["alerts@bank.com"] });
    assert.equal(pickSource([mail], { kind: "email", sender: "Bank Alerts <Alerts@Bank.com>", text: "" })?.id, "mail");
  });
});

describe("main and backup channels", () => {
  const notification = { date: "2026-11-26", description: "KOPITIAM BEDOK", amountIn: null, amountOut: 6.8, cardId: "c1", time: "12:35" };
  it("pairs one card's reports of the same purchase", () => {
    const email = { ...notification, description: "Kopitiam Bedok Pte Ltd", time: "12:37" };
    const score = scoreChannelPair(email, notification);
    assert.ok(score && score.score >= 0.8);
    assert.ok(score!.reasons.includes("Same card") && score!.reasons.includes("Same time"));
    // Without times, the same card, amount and day is still one purchase.
    assert.ok(scoreChannelPair({ ...email, time: null }, notification));
  });

  it("keeps different cards, far-apart times and other amounts apart", () => {
    assert.equal(scoreChannelPair({ ...notification, cardId: "c2" }, notification), null);
    assert.equal(scoreChannelPair({ ...notification, time: "18:10" }, notification), null);
    assert.equal(scoreChannelPair({ ...notification, amountOut: 6.9 }, notification), null);
    assert.equal(scoreChannelPair({ ...notification, date: "2026-11-24", description: "GRAB", time: null, cardId: null }, notification), null);
  });
});

describe("watch list and suggestions", () => {
  it("groups enabled sources by kind with the packages and senders to watch", () => {
    const account = { id: "acc", name: "UOB One", type: "credit_card", institution: "UOB" };
    const list = watchList([
      { ...source({ id: "n1", senders: ["com.uob.mighty"], cardId: "c1" }), account, card: { id: "c1", last4: "4591", nickname: null } },
      { ...source({ id: "n2", senders: ["com.uob.mighty"], enabled: false }), account, card: null },
      { ...source({ id: "e1", kind: "email", senders: ["unialerts@uobgroup.com"], channel: "backup", subjectPatterns: ["Transaction Alert"] }), account, card: null },
    ]);
    assert.deepEqual(list.notification.packages, ["com.uob.mighty"]);
    assert.deepEqual(list.notification.sources.map((item) => item.id), ["n1"]);
    assert.equal(list.notification.sources[0].card?.last4, "4591");
    assert.deepEqual(list.email.senders, ["unialerts@uobgroup.com"]);
    assert.equal(list.email.sources[0].channel, "backup");
    assert.equal(list.email.externalId, "email:<Message-ID>");
  });

  it("suggests PayLah emails and the SimplyGo app from imports, once, and never enabled", () => {
    const accounts = [
      { id: "p", name: "Paylah", institution: null, archived: false, identifiers: ["8888880012044058"], parserIds: ["dbs_paylah_statement"], cards: [] },
      { id: "s", name: "SimplyGo (UOB Credit Card)", institution: null, archived: false, identifiers: ["SimplyGo"], parserIds: [], cards: [] },
      { id: "d", name: "DBS Multiplier", institution: null, archived: false, identifiers: ["2723489251"], parserIds: ["dbs_posb_consolidated"], cards: [] },
    ];
    const suggestions = suggestSources(accounts, []);
    assert.deepEqual(
      suggestions.map((item) => [item.accountId, item.kind, item.senders[0]]),
      [
        ["p", "email", "paylah.alert@dbs.com"],
        ["s", "notification", "sg.com.transitlink"],
      ],
    );
    assert.ok(suggestions.every((item) => !("enabled" in item)));
    assert.deepEqual(suggestions[0].subjectPatterns, ["Transaction Alerts"]);
    assert.equal(suggestSources(accounts, [{ accountId: "p", kind: "email", senders: ["paylah.alert@dbs.com"] }]).length, 1);
  });
});
