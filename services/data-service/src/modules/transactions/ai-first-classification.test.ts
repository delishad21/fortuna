import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import type { PrismaClient } from "@prisma/client";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import { hashApiTokenSecret } from "../auth/api-token";
import { createAgentTransactionsRouter } from "./agent-transactions.controller";
import { createRulesRouter } from "../rules/rules.controller";
import { answerDraftAccountQuestion, draftAccountQuestions } from "../imports/draft-account-questions";

async function token(db: PrismaClient, userId: string, id: string, scopes: string[]) {
  await db.apiToken.create({
    data: { id, userId, name: id, secretHash: hashApiTokenSecret(`${id}-secret`), scopes },
  });
  return { Authorization: `Bearer pfa_${id}.${id}-secret`, "Content-Type": "application/json" };
}

async function serve(db: PrismaClient) {
  const app = express();
  app.use(express.json());
  app.use((_request, _response, next) => void withDatabase(db, async () => next()));
  app.use("/api/agent/transactions", createAgentTransactionsRouter(db));
  app.use("/api/agent/rules", createRulesRouter());
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/agent`;
  const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  return { server, call };
}

/** Johan's accounts: DBS Multiplier, PayLah, a UOB card and categories. */
async function setup(db: PrismaClient, name: string) {
  const user = await db.user.create({ data: { username: name } });
  await db.userSettings.create({ data: { userId: user.id, currency: "SGD" } });
  const dbs = await db.financialAccount.create({ data: { userId: user.id, name: "DBS Multiplier", type: "savings" } });
  await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "2723489251", accountId: dbs.id } });
  const dbsCard = await db.card.create({ data: { userId: user.id, accountId: dbs.id, last4: "5128" } });
  const paylah = await db.financialAccount.create({ data: { userId: user.id, name: "Paylah", type: "other" } });
  await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "8888880012044058", accountId: paylah.id } });
  const uob = await db.financialAccount.create({ data: { userId: user.id, name: "UOB Credit Card", type: "credit_card" } });
  await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "4265-****-****-4591", accountId: uob.id } });
  const uobCard = await db.card.create({ data: { userId: user.id, accountId: uob.id, last4: "4591" } });
  for (const category of ["Food", "Transportation", "Shopping", "Subscriptions", "Bills"])
    await db.category.create({ data: { userId: user.id, name: category } });
  const writer = await token(db, user.id, `${name.slice(0, 6)}w`, ["transactions:write"]);
  const reviewer = await token(db, user.id, `${name.slice(0, 6)}r`, ["transactions:review"]);
  const rules = await token(db, user.id, `${name.slice(0, 6)}x`, ["rules:write"]);
  return { user, dbs, dbsCard, paylah, uob, uobCard, writer, reviewer, rules };
}

const entry = (externalId: string, extra: Record<string, unknown>) => ({
  externalId,
  date: "2026-12-02",
  ...extra,
});

test("PayLah ↔ DBS Multiplier transfers are Internal; the PayLah email stays the real transaction", () =>
  withChatDb(async (db) => {
    const { user, writer } = await setup(db, "paylah-pairs");
    const { server, call } = await serve(db);
    const post = async (body: Record<string, unknown>) => {
      const response = await call("POST", "/transactions", writer, body);
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return response.body.transaction;
    };
    const row = (id: string) => db.transaction.findUniqueOrThrow({ where: { id }, include: { category: true } });
    try {
      // Top-up: DBS's alert first, then the PayLah payment it paid for.
      const topUp = await post(entry("t-1", { description: "Funds Transfer TOP-UP TO PAYLAH! : 96317826", amountOut: 4.5, account: "2723489251", decision: { category: "Food", reason: "guess" } }));
      assert.equal(topUp.category.name, "Internal");
      assert.equal(topUp.classification.decidedBy, "structural");
      const juice = await post(entry("t-2", { description: "THE JUICE M", amountOut: 4.5, account: "Paylah", decision: { category: "Food", transactionType: "purchase", merchant: "The Juice Market", reason: "Same as past juice", confidence: 0.9 } }));
      assert.equal(juice.category.name, "Food", "the PayLah payment is the real transaction");
      assert.equal(juice.classification.decidedBy, "assistant");
      assert.equal(juice.merchant, "The Juice Market");
      assert.equal(juice.transactionType, "purchase");
      assert.equal(juice.decision.reason, "Same as past juice");
      // The top-up now points at the payment it paid for.
      const pairedTopUp = await row(topUp.id);
      assert.equal(pairedTopUp.category?.name, "Internal");
      assert.equal((pairedTopUp.metadata as any).classification.structural.counterpartId, juice.id);
      assert.equal(juice.classification.structural, undefined);

      // Max-out: the PayLah receipt arrives first, then DBS's "maxed out" credit.
      const received = await post(entry("m-1", { description: "Received S$35.83 from MADELINE", amountIn: 35.83, account: "Paylah", decision: { category: "Reimbursement", transactionType: "reimbursement" } }));
      assert.equal(received.category.name, "Reimbursement");
      const maxed = await post(entry("m-2", { description: "Funds Transfer MAXED OUT FROM PAYLAH! : MADELINE", amountIn: 35.83, account: "2723489251" }));
      assert.equal(maxed.category.name, "Internal");
      assert.equal(maxed.classification.structural.kind, "paylah_transfer");
      assert.equal(maxed.classification.structural.counterpartId, received.id);
      const receivedAfter = await row(received.id);
      assert.equal(receivedAfter.category?.name, "Reimbursement", "the receipt keeps its own classification");
      assert.equal((receivedAfter.metadata as any).structuralPair.counterpartId, maxed.id);

      // Send back: the bank side first, then PayLah's own leg; both are Internal and point at each other.
      const back = await post(entry("s-1", { description: "SEND BACK FROM PAYLAH! : 96317826", amountIn: 34.66, account: "2723489251" }));
      assert.equal(back.category.name, "Internal");
      const leg = await post(entry("s-2", { description: "SEND MONEY TO MY ACCOUNT", amountOut: 34.66, account: "Paylah", decision: { category: "Shopping" } }));
      assert.equal(leg.category.name, "Internal");
      assert.equal(leg.classification.decidedBy, "structural");
      assert.equal(leg.classification.structural.counterpartId, back.id);
      const backAfter = await row(back.id);
      assert.equal((backAfter.linkage as any).pair.counterpartId, leg.id);

      // PayLah money from someone straight into the bank is not a transfer of Johan's own.
      const friend = await post(entry("f-1", { description: "PayLah funds received (96317826)", amountIn: 1.71, account: "2723489251", decision: { category: "Food" } }));
      assert.equal(friend.category.name, "Food");
      assert.equal(friend.classification.decidedBy, "assistant");
      assert.ok(await db.transaction.count({ where: { userId: user.id } }) >= 7);
    } finally {
      server.close();
    }
  }));

test("a credit card bill payment is Internal on both sides, whichever side comes first", () =>
  withChatDb(async (db) => {
    const { writer, uob } = await setup(db, "bill-pairs");
    const { server, call } = await serve(db);
    const post = async (body: Record<string, unknown>) => (await call("POST", "/transactions", writer, body)).body.transaction;
    try {
      const bank = await post(entry("b-1", { description: "Bill payment to UOB card 4591", amountOut: 512.3, account: "2723489251", decision: { transactionType: "bill", category: "Bills" } }));
      assert.equal(bank.category.name, "Internal", "the payee is a card account Fortuna knows");
      assert.equal(bank.classification.structural.kind, "card_bill_payment");
      const card = await post(entry("b-2", { date: "2026-12-04", description: "PAYMENT - THANK YOU", amountIn: 512.3, card: { last4: "4591" } }));
      assert.equal(card.accountId, uob.id);
      assert.equal(card.category.name, "Internal");
      assert.equal(card.classification.structural.counterpartId, bank.id);
      const bankAfter = await db.transaction.findUniqueOrThrow({ where: { id: bank.id } });
      assert.equal((bankAfter.linkage as any).pair.counterpartId, card.id);

      // The card's side first this time; the bank's alert marks it when it comes.
      const cardFirst = await post(entry("b-3", { date: "2026-12-20", description: "PAYMENT RECEIVED", amountIn: 88, card: { last4: "4591" }, decision: { category: "Shopping", transactionType: "refund" } }));
      assert.equal(cardFirst.category.name, "Shopping", "a card credit alone may be a refund");
      const bankLater = await post(entry("b-4", { date: "2026-12-21", description: "Bill payment UOB CREDIT CARD", amountOut: 88, account: "2723489251" }));
      assert.equal(bankLater.category.name, "Internal");
      const cardAfter = await db.transaction.findUniqueOrThrow({ where: { id: cardFirst.id }, include: { category: true } });
      assert.equal(cardAfter.category?.name, "Internal");
      assert.equal((cardAfter.metadata as any).classification.decidedBy, "structural");

      // A purchase of the same amount isn't a bill payment.
      const lunch = await post(entry("b-5", { date: "2026-12-20", description: "KOPITIAM", amountOut: 88, account: "2723489251", decision: { category: "Food" } }));
      assert.equal(lunch.category.name, "Food");
    } finally {
      server.close();
    }
  }));

test("account- and parser-scoped rules apply to assistant entries by account", () =>
  withChatDb(async (db) => {
    const { user, dbs, uob, writer } = await setup(db, "scoped-rules");
    await db.importRule.create({
      data: { userId: user.id, name: "UOB card BUS/MRT is Internal", accountIdentifier: "4265-****-****-4591", matchValue: "BUS/MRT", markInternal: true, sortOrder: 1 },
    });
    await db.importRule.create({
      data: { userId: user.id, name: "BUS/MRT transactions are Transportation", matchValue: "BUS/MRT", setCategoryName: "Transportation", setLabel: "BUS/MRT", sortOrder: 2 },
    });
    // A statement parser's rule: it applies to the accounts that parser imports into.
    const batch = await db.importBatch.create({
      data: { userId: user.id, filename: "dbs.pdf", fileType: "pdf", parserId: "dbs_posb_consolidated", expiresAt: new Date("2027-01-01") },
    });
    await db.transaction.create({
      data: { userId: user.id, date: new Date("2026-11-01"), description: "OLD", amountOut: 1, accountId: dbs.id, importBatchId: batch.id, entrySource: "statement" },
    });
    const parserRule = await db.importRule.create({
      data: { userId: user.id, name: "Town council is Bills", parserId: "dbs_posb_consolidated", matchValue: "TOWN COUNCIL", setCategoryName: "Bills" },
    });
    const { server, call } = await serve(db);
    const post = async (body: Record<string, unknown>) => (await call("POST", "/transactions", writer, body)).body.transaction;
    try {
      const ride = await post(entry("r-1", { description: "BUS/MRT 123456", amountOut: 2.1, card: { last4: "4591" }, decision: { category: "Transportation", reason: "a bus ride" } }));
      assert.equal(ride.accountId, uob.id);
      assert.equal(ride.category.name, "Internal", "SimplyGo holds the UOB card's trips");
      assert.equal(ride.classification.decidedBy, "rule");
      assert.equal(ride.classification.ruleName, "UOB card BUS/MRT is Internal");
      assert.deepEqual(ride.classification.conflict, { ruleId: ride.classification.ruleId, rule: "Internal", assistant: "Transportation" });
      assert.equal(ride.questions[0].source, "rule_conflict");
      assert.deepEqual(ride.reviewReasons, ["question"]);

      const debitRide = await post(entry("r-2", { description: "BUS/MRT 98765", amountOut: 1.8, card: { last4: "5128" } }));
      assert.equal(debitRide.category.name, "Transportation", "the UOB rule is only for the UOB card");
      assert.equal(debitRide.label, "BUS/MRT");

      const council = await post(entry("r-3", { description: "GIRO TOWN COUNCIL", amountOut: 80, account: "2723489251", decision: { category: "Bills" } }));
      assert.equal(council.classification.decidedBy, "rule");
      assert.equal(council.classification.ruleId, parserRule.id);
      const elsewhere = await post(entry("r-4", { description: "TOWN COUNCIL", amountOut: 80, card: { last4: "4591" }, decision: { category: "Shopping" } }));
      assert.equal(elsewhere.classification.decidedBy, "assistant", "the parser never imported into the UOB account");

      const hits = await db.importRule.findMany({ where: { userId: user.id }, orderBy: { sortOrder: "asc" } });
      assert.equal(hits.find((rule) => rule.name === "UOB card BUS/MRT is Internal")!.hitCount, 1);
      assert.ok(hits.find((rule) => rule.name === "UOB card BUS/MRT is Internal")!.lastHitAt);
      assert.equal(hits.find((rule) => rule.id === parserRule.id)!.hitCount, 1);
    } finally {
      server.close();
    }
  }));

test("rules from the assistant: origins, reasons and the examples requirement", () =>
  withChatDb(async (db) => {
    const { user, uobCard, writer, reviewer, rules } = await setup(db, "rule-origins");
    const { server, call } = await serve(db);
    const subscriptions = await db.category.findFirstOrThrow({ where: { userId: user.id, name: "Subscriptions" } });
    const examples = [];
    for (const [index, amount] of [15.98, 15.98, 15.98].entries())
      examples.push(
        await db.transaction.create({
          data: {
            userId: user.id,
            date: new Date(`2026-0${index + 7}-03T00:00:00Z`),
            description: "NETFLIX.COM",
            amountOut: amount,
            cardId: uobCard.id,
            categoryId: subscriptions.id,
            reviewStatus: "reviewed",
          },
        }),
      );
    const unreviewed = await db.transaction.create({
      data: { userId: user.id, date: new Date("2026-10-03"), description: "NETFLIX.COM", amountOut: 15.98, cardId: uobCard.id, categoryId: subscriptions.id, reviewStatus: "to_review" },
    });
    const rule = (extra: Record<string, unknown>) => ({
      matchValue: "NETFLIX",
      setCategory: "Subscriptions",
      origin: "assistant_detected",
      reason: "Netflix every month on the UOB card",
      card: { last4: "4591" },
      ...extra,
    });
    try {
      assert.equal((await call("POST", "/rules", writer, rule({ exampleIds: examples.map((item) => item.id) }))).status, 403, "needs rules:write");
      const noReason = await call("POST", "/rules", rules, { ...rule({ exampleIds: examples.map((item) => item.id) }), reason: undefined });
      assert.equal(noReason.status, 400);
      const tooFew = await call("POST", "/rules", rules, rule({ exampleIds: examples.slice(0, 2).map((item) => item.id) }));
      assert.equal(tooFew.status, 400);
      assert.match(tooFew.body.error, /at least 3/);
      const notReviewed = await call("POST", "/rules", rules, rule({ exampleIds: [...examples.slice(0, 2).map((item) => item.id), unreviewed.id] }));
      assert.equal(notReviewed.status, 400);
      assert.deepEqual(notReviewed.body.problems, [{ id: unreviewed.id, problem: "not reviewed yet" }]);
      const inconsistent = await call("POST", "/rules", rules, rule({ setCategory: "Food", exampleIds: examples.map((item) => item.id) }));
      assert.equal(inconsistent.status, 400);
      assert.equal(inconsistent.body.problems.length, 3);

      const created = await call("POST", "/rules", rules, rule({ exampleIds: examples.map((item) => item.id), amountMin: 15, amountMax: 17 }));
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.rule.origin, "assistant_detected");
      assert.equal(created.body.rule.enabled, true, "no confirmed flag needed");
      assert.equal(created.body.rule.card.last4, "4591");
      assert.equal(created.body.rule.examples.length, 3);
      assert.equal(created.body.rule.examples[0].category, "Subscriptions");

      // A stated recurring bill stands in for examples.
      const bill = await call("POST", "/rules", rules, {
        matchValue: "SP SERVICES",
        setCategory: "Bills",
        origin: "assistant_detected",
        reason: "Monthly utilities bill",
        recurringBill: { name: "SP utilities", frequency: "monthly" },
      });
      assert.equal(bill.status, 201, JSON.stringify(bill.body));
      // On request: a reason is enough.
      const asked = await call("POST", "/rules", rules, {
        matchValue: "GRAB",
        setCategory: "Transportation",
        origin: "assistant_on_request",
        reason: "Johan: Grab is always transport",
      });
      assert.equal(asked.status, 201);
      assert.equal((await call("POST", "/rules", rules, { matchValue: "X", setCategory: "Food", origin: "user", reason: "r" })).status, 400);

      // The rule classifies the next Netflix charge and counts the hit.
      const next = await call("POST", "/transactions", writer, entry("n-1", { description: "NETFLIX.COM", amountOut: 15.98, card: { last4: "4591" } }));
      assert.equal(next.body.transaction.classification.decidedBy, "rule");
      assert.equal(next.body.transaction.category.name, "Subscriptions");

      // Outside its range it doesn't apply; a question asks instead.
      const pricier = await call("POST", "/transactions", writer, entry("n-2", { description: "NETFLIX.COM", amountOut: 22.98, card: { last4: "4591" }, decision: { category: "Shopping" } }));
      assert.equal(pricier.body.transaction.category.name, "Shopping");
      const [rangeQuestion] = pricier.body.transaction.questions;
      assert.equal(rangeQuestion.source, "amount_range");
      assert.equal(rangeQuestion.ruleId, created.body.rule.id);
      const applied = await call("POST", "/transactions/review/questions/answer", reviewer, {
        transactionId: pricier.body.transaction.id,
        questionId: rangeQuestion.id,
        option: "apply",
      });
      assert.equal(applied.status, 200, JSON.stringify(applied.body));
      assert.equal(applied.body.transaction.category.name, "Subscriptions");
      assert.deepEqual(applied.body.transaction.questions, []);
      assert.ok(!applied.body.transaction.reviewReasons.includes("question"));

      // Listing with stats.
      const listed = await call("GET", "/rules?origin=assistant_detected", reviewer);
      assert.equal(listed.status, 200);
      const netflix = listed.body.rules.find((item: any) => item.id === created.body.rule.id);
      assert.equal(netflix.hitCount, 1);
      assert.ok(netflix.lastHitAt);
      assert.equal(netflix.reason, "Netflix every month on the UOB card");
      assert.equal(netflix.amountMin, 15);

      // Updating keeps the examples requirement; disabling works.
      assert.equal((await call("PATCH", `/rules/${created.body.rule.id}`, rules, { exampleIds: [examples[0].id] })).status, 400);
      const disabled = await call("POST", `/rules/${created.body.rule.id}/disable`, rules);
      assert.equal(disabled.body.rule.enabled, false);
      const audit = await db.agentAuditEvent.findMany({ where: { userId: user.id, targetType: "import_rule" } });
      assert.ok(audit.some((event) => event.toolName === "create_rule"));
      assert.ok(audit.some((event) => event.toolName === "disable_rule"));
    } finally {
      server.close();
    }
  }));

test("rules the assistant detected show in the next review with Undo, which reopens what they touched", () =>
  withChatDb(async (db) => {
    const { user, writer, reviewer, rules } = await setup(db, "rule-undo");
    const food = await db.category.findFirstOrThrow({ where: { userId: user.id, name: "Food" } });
    const examples = [];
    for (let index = 0; index < 3; index += 1)
      examples.push(
        await db.transaction.create({
          data: { userId: user.id, date: new Date(`2026-11-0${index + 1}T00:00:00Z`), description: "YA KUN KAYA", label: "Breakfast", amountOut: 5, categoryId: food.id, reviewStatus: "reviewed" },
        }),
      );
    const { server, call } = await serve(db);
    try {
      const created = await call("POST", "/rules", rules, {
        matchValue: "YA KUN",
        setCategory: "Food",
        setLabel: "Breakfast",
        origin: "assistant_detected",
        reason: "Three Ya Kun breakfasts, all Food",
        exampleIds: examples.map((item) => item.id),
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const ruleId = created.body.rule.id;
      const touched = await call("POST", "/transactions", writer, entry("y-1", {
        description: "YA KUN KAYA TOAST",
        amountOut: 6,
        account: "2723489251",
        decision: { category: "Shopping", label: "Kaya toast", reason: "merch", confidence: 0.4 },
      }));
      assert.equal(touched.body.transaction.classification.decidedBy, "rule");
      assert.equal(touched.body.transaction.label, "Breakfast");

      const queue = await call("GET", "/transactions/review", reviewer);
      assert.deepEqual(queue.body.newRules.map((rule: any) => rule.id), [ruleId]);
      assert.equal(queue.body.newRules[0].reason, "Three Ya Kun breakfasts, all Food");

      const undone = await call("POST", `/transactions/review/rules/${ruleId}/undo`, reviewer);
      assert.equal(undone.status, 200, JSON.stringify(undone.body));
      assert.equal(undone.body.rule.enabled, false);
      assert.ok(undone.body.rule.undoneAt);
      assert.equal(undone.body.reopened, 1);
      const after = await db.transaction.findUniqueOrThrow({ where: { id: touched.body.transaction.id }, include: { category: true } });
      assert.equal(after.reviewStatus, "to_review");
      assert.ok(after.reviewReasons.includes("rule_undone"));
      assert.equal(after.category?.name, "Shopping", "classified again from the assistant's own decision");
      assert.equal(after.label, "Kaya toast");
      assert.ok(after.reviewReasons.includes("low_confidence"));
      assert.equal((await call("GET", "/transactions/review", reviewer)).body.newRules.length, 0);

      // A review acknowledges rules made before it.
      const second = await call("POST", "/rules", rules, {
        matchValue: "KAYA",
        setCategory: "Food",
        origin: "assistant_detected",
        reason: "Kaya is food",
        exampleIds: examples.map((item) => item.id),
      });
      assert.equal(second.status, 201, JSON.stringify(second.body));
      assert.equal((await call("GET", "/transactions/review", reviewer)).body.newRules.length, 1);
      await call("POST", "/transactions/review/status", reviewer, { ids: [after.id], status: "reviewed" });
      assert.equal((await call("GET", "/transactions/review", reviewer)).body.newRules.length, 0);
    } finally {
      server.close();
    }
  }));

test("questions on entries are answered through the review API", () =>
  withChatDb(async (db) => {
    const { writer, reviewer } = await setup(db, "entry-questions");
    const { server, call } = await serve(db);
    try {
      const sent = await call("POST", "/transactions", writer, entry("q-1", {
        description: "TONKATSU BY MA MAISON",
        amountOut: 96,
        card: { last4: "4591" },
        decision: { category: "Food", transactionType: "purchase", reason: "dinner", confidence: 0.55, precedentIds: [] },
        questions: [
          { field: "label", prompt: "What was it?", options: ["Dinner with Madeline", "Team dinner"], allowOther: true },
          { field: "reimbursable", prompt: "Shared with Madeline?", options: ["Full", "Half", "Not shared"] },
        ],
      }));
      assert.equal(sent.status, 201, JSON.stringify(sent.body));
      const transaction = sent.body.transaction;
      assert.deepEqual(transaction.reviewReasons, ["no_rule_matched", "assistant_category", "low_confidence", "question"]);
      assert.equal(transaction.questions.length, 2);
      const [label, shared] = transaction.questions;
      assert.deepEqual(label.options.map((option: any) => option.id), ["Dinner with Madeline", "Team dinner"]);

      const wrong = await call("POST", "/transactions/review/questions/answer", reviewer, { transactionId: transaction.id, questionId: shared.id, option: "Quarter" });
      assert.equal(wrong.status, 400);
      const free = await call("POST", "/transactions/review/questions/answer", reviewer, { transactionId: transaction.id, questionId: shared.id, value: "Quarter" });
      assert.equal(free.status, 400, "this one takes its options");

      const named = await call("POST", "/transactions/review/questions/answer", reviewer, { transactionId: transaction.id, questionId: label.id, value: "Birthday dinner" });
      assert.equal(named.status, 200, JSON.stringify(named.body));
      assert.equal(named.body.transaction.label, "Birthday dinner");
      assert.equal(named.body.transaction.questions.length, 1);
      assert.ok(named.body.transaction.reviewReasons.includes("question"));

      const last = await call("POST", "/transactions/review/questions/answer", reviewer, {
        transactionId: transaction.id,
        questionId: shared.id,
        option: "Half",
        markReviewed: true,
      });
      assert.equal(last.status, 200);
      assert.deepEqual(last.body.transaction.questions, []);
      assert.equal(last.body.transaction.reviewStatus, "reviewed");
      const stored = await db.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
      assert.deepEqual((stored.metadata as any).answers.map((item: any) => item.answer), ["Birthday dinner", "Half"]);
      assert.equal((await call("POST", "/transactions/review/questions/answer", reviewer, { transactionId: transaction.id, questionId: shared.id, option: "Half" })).status, 404);
    } finally {
      server.close();
    }
  }));

test("an unknown statement identifier on a draft is a question, answered by adding or linking the account", () =>
  withChatDb(async (db) => {
    const { user, dbs, uob } = await setup(db, "draft-questions");
    await withDatabase(db, async () => {
      const [card, bank] = await draftAccountQuestions(user.id, ["5323-****-****-2124", "OCBC 360 123"]);
      assert.equal(card.field, "account");
      assert.ok(card.options.some((option) => option.id === `add_card:${uob.id}`));
      assert.ok(card.options.some((option) => option.id === "new_account:credit_card"));
      assert.ok(!bank.options.some((option) => option.id.startsWith("add_card:")));
      assert.ok(bank.options.some((option) => option.id === `link:${dbs.id}`));

      const added = await answerDraftAccountQuestion(user.id, { identifier: "5323-****-****-2124", option: `add_card:${uob.id}` });
      assert.equal(added.accountId, uob.id);
      assert.equal(await db.card.count({ where: { accountId: uob.id, last4: "2124" } }), 1);
      assert.equal(await db.accountIdentifier.count({ where: { userId: user.id, accountIdentifier: "5323-****-****-2124", accountId: uob.id } }), 1);
      const made = await answerDraftAccountQuestion(user.id, { identifier: "OCBC 360 123", option: "new_account:savings", name: "OCBC 360" });
      assert.equal(made.created, true);
      assert.equal((await db.financialAccount.findUniqueOrThrow({ where: { id: made.accountId } })).autoCreated, false);
      await assert.rejects(answerDraftAccountQuestion(user.id, { identifier: "OCBC 360 123", option: `link:${dbs.id}` }), /already belongs/);
    });
  }));
