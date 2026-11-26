import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { withChatDb } from "../chat/test-harness";
import {
  addCard,
  attachIdentifier,
  confirmAccount,
  createAccount,
  deleteAccount,
  listAccounts,
  mergeAccount,
  resolveAccount,
  setImage,
  updateCard,
} from "./accounts.service";
import { cleanupUnusedImages, readImage } from "../images/image-store";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const tx = (userId: string, id: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId,
  date: new Date("2026-11-01"),
  description: id,
  amountOut: 1,
  ...extra,
});

test("statement identifiers get accounts, and transactions follow identifiers and cards", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "acct-triggers" } });
    const other = await db.user.create({ data: { username: "acct-other" } });

    // A transaction whose identifier isn't saved yet has no account...
    await db.transaction.create({ data: tx(user.id, "t1", { accountIdentifier: "4265-****-****-4591" }) });
    assert.equal((await db.transaction.findUniqueOrThrow({ where: { id: "t1" } })).accountId, null);
    // ...until the identifier is saved, which creates an account for it.
    const uob = await db.accountIdentifier.create({
      data: { userId: user.id, accountIdentifier: "4265-****-****-4591", label: "UOB Credit Card", color: "#3b82f6" },
    });
    const uobAccount = await db.financialAccount.findUniqueOrThrow({ where: { id: uob.accountId! } });
    assert.equal(uobAccount.name, "UOB Credit Card");
    assert.equal(uobAccount.type, "credit_card");
    assert.equal(uobAccount.color, "#3b82f6");
    assert.equal((await db.transaction.findUniqueOrThrow({ where: { id: "t1" } })).accountId, uobAccount.id);

    // New imports carrying the identifier land on its account.
    await db.transaction.create({ data: tx(user.id, "t2", { accountIdentifier: "4265-****-****-4591" }) });
    assert.equal((await db.transaction.findUniqueOrThrow({ where: { id: "t2" } })).accountId, uobAccount.id);

    // A card decides the account and gives the transaction the account's identifier.
    const card = await addCard(db, user.id, uobAccount.id, { last4: "4591", network: "visa" });
    await db.transaction.create({ data: tx(user.id, "t3", { cardId: card.id }) });
    const t3 = await db.transaction.findUniqueOrThrow({ where: { id: "t3" } });
    assert.equal(t3.accountId, uobAccount.id);
    assert.equal(t3.accountIdentifier, "4265-****-****-4591");

    // Changing the identifier moves the transaction and drops a card that isn't on the new account.
    const dbs = await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "2723489251", label: "DBS Multiplier" } });
    await db.transaction.update({ where: { id: "t3" }, data: { accountIdentifier: "2723489251" } });
    const moved = await db.transaction.findUniqueOrThrow({ where: { id: "t3" } });
    assert.equal(moved.accountId, dbs.accountId);
    assert.equal(moved.cardId, null);

    // Setting the account picks that account's identifier.
    await db.transaction.update({ where: { id: "t3" }, data: { accountId: uobAccount.id } });
    assert.equal((await db.transaction.findUniqueOrThrow({ where: { id: "t3" } })).accountIdentifier, "4265-****-****-4591");

    // Another user's account is refused.
    const foreign = await createAccount(db, other.id, { name: "Theirs", type: "other", color: "#000000" });
    await assert.rejects(db.transaction.update({ where: { id: "t3" }, data: { accountId: foreign.id } }), /does not belong/);
  }));

test("merging accounts moves identifiers, cards and transactions, and resolve finds cards by last 4", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "acct-merge" } });
    const uob = await createAccount(db, user.id, {
      name: "UOB Credit Card",
      type: "credit_card",
      color: "#3b82f6",
      identifiers: ["4265-****-****-4591"],
    });
    const uobCard = await addCard(db, user.id, uob.id, { last4: "4591" });
    const simplyGo = await db.accountIdentifier.create({
      data: { userId: user.id, accountIdentifier: "SimplyGo", label: "SimplyGo (UOB Credit Card)" },
    });
    const simplyGoCard = await addCard(db, user.id, simplyGo.accountId!, { last4: "4591" });
    const extraCard = await addCard(db, user.id, simplyGo.accountId!, { last4: "1111" });
    await db.transaction.create({ data: tx(user.id, "bus", { accountIdentifier: "SimplyGo", cardId: simplyGoCard.id }) });
    await db.transaction.create({ data: tx(user.id, "mrt", { accountIdentifier: "SimplyGo", cardId: extraCard.id }) });

    const merged = await mergeAccount(db, user.id, simplyGo.accountId!, uob.id);
    assert.deepEqual(merged.identifiers.map((i) => i.identifier).sort(), ["4265-****-****-4591", "SimplyGo"]);
    assert.deepEqual(merged.cards.map((c) => c.last4).sort(), ["1111", "4591"]);
    assert.equal(await db.financialAccount.count({ where: { id: simplyGo.accountId! } }), 0);
    const bus = await db.transaction.findUniqueOrThrow({ where: { id: "bus" } });
    assert.equal(bus.accountId, uob.id);
    assert.equal(bus.accountIdentifier, "SimplyGo", "the statement identifier is kept");
    assert.equal(bus.cardId, uobCard.id, "the duplicate card's transactions use the surviving card");
    const mrt = await db.transaction.findUniqueOrThrow({ where: { id: "mrt" } });
    assert.equal(mrt.cardId, extraCard.id);

    const matches = await resolveAccount(db, user.id, { last4: "4591" });
    assert.equal(matches[0].account.id, uob.id);
    assert.equal(matches[0].card?.id, uobCard.id);
    assert.equal(matches[0].matchedBy, "card_last4");
    assert.equal((await resolveAccount(db, user.id, { identifier: "SimplyGo" }))[0].account.id, uob.id);

    // An automatically created account is listed for review until confirmed.
    const auto = await createAccount(db, user.id, {
      name: "Card ending 9876",
      type: "credit_card",
      color: "#000000",
      autoCreated: true,
      autoCreatedFrom: "card:9876",
    });
    assert.deepEqual((await listAccounts(db, user.id, { needsReview: true })).map((a) => a.autoCreatedFrom), ["card:9876"]);
    await confirmAccount(db, user.id, auto.id);
    assert.equal((await listAccounts(db, user.id, { needsReview: true })).length, 0);

    // Moving an identifier moves its transactions.
    const other = await createAccount(db, user.id, { name: "Partner card", type: "credit_card", color: "#000000" });
    await attachIdentifier(db, user.id, other.id, "SimplyGo");
    assert.equal((await db.transaction.findUniqueOrThrow({ where: { id: "bus" } })).accountId, other.id);

    assert.equal((await db.transaction.findUniqueOrThrow({ where: { id: "mrt" } })).cardId, null, "its card stayed on UOB");

    // A card moved to another account takes its transactions along.
    await db.transaction.create({ data: tx(user.id, "shop", { cardId: extraCard.id }) });
    await updateCard(db, user.id, extraCard.id, { accountId: other.id });
    const shop = await db.transaction.findUniqueOrThrow({ where: { id: "shop" } });
    assert.equal(shop.accountId, other.id);
    assert.equal(shop.cardId, extraCard.id);
    assert.equal(shop.accountIdentifier, "SimplyGo");

    // Accounts with transactions can't be deleted; empty ones can.
    await assert.rejects(deleteAccount(db, user.id, other.id), /archive it or merge/);
    const empty = await createAccount(db, user.id, { name: "Unused", type: "savings", color: "#000000" });
    await deleteAccount(db, user.id, empty.id);
    assert.equal((await listAccounts(db, user.id)).some((a) => a.id === empty.id), false);
  }));

test("images are stored once per user, cards fall back to the account's, and unused files are cleaned up", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fortuna-images-"));
  process.env.IMAGE_STORAGE_DIR = dir;
  try {
    await withChatDb(async (db) => {
      const user = await db.user.create({ data: { username: "acct-images" } });
      const other = await db.user.create({ data: { username: "acct-images-other" } });
      const account = await createAccount(db, user.id, { name: "DBS", type: "savings", color: "#000000" });
      const card = await addCard(db, user.id, account.id, { last4: "1234" });
      await db.transaction.create({ data: tx(user.id, "img1") });
      await db.transaction.create({ data: tx(user.id, "img2") });

      const base64 = PNG.toString("base64");
      const first = await setImage(db, user.id, { type: "transaction", id: "img1" }, { base64 });
      const second = await setImage(db, user.id, { type: "transaction", id: "img2" }, { base64: `data:image/png;base64,${base64}` });
      assert.equal(first.imageId, second.imageId, "the same logo is stored once");
      assert.equal((await readdir(path.join(dir, user.id))).length, 1);
      assert.equal((await readImage(db, other.id, first.imageId!)), null, "other users can't read it");
      assert.equal((await readImage(db, user.id, first.imageId!))?.image.contentType, "image/png");

      await setImage(db, user.id, { type: "account", id: account.id }, { base64 });
      const listed = (await listAccounts(db, user.id))[0];
      assert.equal(listed.cards[0].id, card.id);
      assert.equal(listed.cards[0].imageUrl, `/api/images/${first.imageId}`, "card falls back to the account image");

      await assert.rejects(
        setImage(db, user.id, { type: "transaction", id: "img1" }, { base64: Buffer.from("<svg></svg>").toString("base64") }),
        /PNG, JPEG, GIF or WebP/,
      );
      await assert.rejects(
        setImage(db, user.id, { type: "transaction", id: "img1" }, { url: "http://127.0.0.1/logo.png" }),
        /public address/,
      );

      // Clearing all uses deletes the file.
      await setImage(db, user.id, { type: "transaction", id: "img1" }, null);
      await setImage(db, user.id, { type: "transaction", id: "img2" }, null);
      assert.equal(await db.storedImage.count({ where: { userId: user.id } }), 1, "still used by the account");
      await setImage(db, user.id, { type: "account", id: account.id }, null);
      assert.equal(await db.storedImage.count({ where: { userId: user.id } }), 0);
      assert.equal((await readdir(path.join(dir, user.id))).length, 0);

      // A deleted transaction's image goes in the hourly sweep.
      await setImage(db, user.id, { type: "transaction", id: "img1" }, { base64 });
      await db.transaction.delete({ where: { id: "img1" } });
      assert.equal(await cleanupUnusedImages(db, new Date(Date.now() + 2 * 60 * 60 * 1000)), 1);
      assert.equal(await db.storedImage.count({ where: { userId: user.id } }), 0);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assistant entries find cards by last 4, and an unknown card gets a flagged account with that card", () =>
  withChatDb(async (db) => {
    const { withDatabase } = await import("../../lib/database-context");
    const { resolveAccount: resolveEntryAccount } = await import("../transactions/assistant-entries.service");
    const user = await db.user.create({ data: { username: "acct-entries" } });
    // An account with no statement identifier, known only by its card.
    const dbs = await createAccount(db, user.id, { name: "DBS Multiplier", type: "savings", color: "#000000" });
    const debit = await addCard(db, user.id, dbs.id, { last4: "1234" });
    await withDatabase(db, async () => {
      const known = await resolveEntryAccount(user.id, { card: { last4: "1234" } });
      assert.equal(known.accountId, dbs.id);
      assert.equal(known.cardId, debit.id);
      assert.equal(known.autoCreated, false);

      const unknown = await resolveEntryAccount(user.id, { card: { last4: "7788" }, externalId: "n-1" });
      assert.equal(unknown.autoCreated, true);
      const created = await db.financialAccount.findUniqueOrThrow({ where: { id: unknown.accountId! }, include: { cards: true } });
      assert.equal(created.autoCreated, true);
      assert.match(created.autoCreatedFrom!, /card 7788/);
      assert.deepEqual(created.cards.map((c) => c.last4), ["7788"]);
      assert.equal(unknown.cardId, created.cards[0].id);

      // Keeping it clears the flag on the account and its identifier.
      await confirmAccount(db, user.id, created.id);
      const again = await resolveEntryAccount(user.id, { card: { last4: "7788" } });
      assert.equal(again.autoCreated, false);
      assert.equal(again.cardId, created.cards[0].id);
    });
  }));
