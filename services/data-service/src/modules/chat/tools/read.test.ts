import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "../test-harness";
import { ReadTools } from "./read";
test("financial totals use exact decimals, isolate users and separate currencies", () =>
  withChatDb(async (db) => {
    const alice = await db.user.create({ data: { username: "summary-alice" } });
    const bob = await db.user.create({ data: { username: "summary-bob" } });
    const base = {
      date: new Date("2026-08-10T00:00:00Z"),
      description: "Lunch",
      currency: "SGD",
      userId: alice.id,
    };
    await db.transaction.createMany({
      data: [
        { ...base, amountOut: "0.10" },
        { ...base, amountOut: "0.20" },
        { ...base, amountOut: "100", linkage: { type: "internal" } },
        {
          ...base,
          amountOut: "20",
          linkage: {
            type: "reimbursed",
            reimbursedByAllocations: [{ transactionId: "r", amount: 5 }],
          },
        },
        {
          ...base,
          amountIn: "55.55",
          linkage: {
            type: "reimbursement",
            reimbursesAllocations: [{ amount: 20 }],
          },
        },
        { ...base, currency: "USD", amountOut: "3.50" },
        { ...base, userId: bob.id, amountOut: "999" },
        { ...base, date: new Date("2026-09-01T00:00:00Z"), amountOut: 1000 },
      ],
    });
    await db.accountIdentifier.create({
      data: { userId: alice.id, accountIdentifier: "DBS" },
    });
    await db.transaction.create({
      data: { ...base, accountIdentifier: "DBS", amountOut: "1.25" },
    });
    const tools = new ReadTools(db);
    const accountResult = await tools.summary(alice.id, {
      dateFrom: "2026-08-01T00:00:00Z",
      dateTo: "2026-09-01T00:00:00Z",
      accountIdentifier: "DBS",
    });
    assert.equal(accountResult.totals[0].expense, "1.25");
    const result = await tools.summary(alice.id, {
      dateFrom: "2026-08-01T00:00:00Z",
      dateTo: "2026-09-01T00:00:00Z",
    });
    assert.equal(
      result.totals.find((t) => t.currency === "SGD")?.expense,
      "16.55",
    );
    assert.equal(
      result.totals.find((t) => t.currency === "SGD")?.income,
      "0.00",
    );
    assert.equal(
      result.totals.find((t) => t.currency === "SGD")?.unallocatedReimbursement,
      "35.55",
    );
    assert.equal(
      result.totals.find((t) => t.currency === "USD")?.expense,
      "3.50",
    );
    assert.equal(result.totals.length, 2);
    await assert.rejects(
      tools.summary(alice.id, {
        dateFrom: "bad",
        dateTo: "2026-09-01T00:00:00Z",
      }),
    );
    await assert.rejects(
      tools.summary(alice.id, {
        dateFrom: "2026-08-01T00:00:00Z",
        dateTo: "2026-09-01T00:00:00Z",
        userId: bob.id,
      }),
    );
  }));
test("transaction search excludes internal rows by default before pagination", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "filter" } });
    const category = await db.category.create({
      data: { userId: user.id, name: "Internal" },
    });
    const base = {
      userId: user.id,
      date: new Date("2026-08-10T00:00:00Z"),
      description: "Transfer",
      amountOut: 10,
    };
    await db.transaction.createMany({
      data: [
        { ...base, linkage: { type: "internal" } },
        { ...base, categoryId: category.id },
        { ...base, description: "Lunch" },
      ],
    });
    const tools = new ReadTools(db),
      range = {
        dateFrom: "2026-08-01T00:00:00Z",
        dateTo: "2026-09-01T00:00:00Z",
      };
    assert.deepEqual(
      (await tools.transactions(user.id, { ...range, limit: 1 })).map(
        (t) => t.description,
      ),
      ["Lunch"],
    );
    assert.equal(
      (await tools.transactions(user.id, { ...range, includeInternal: true }))
        .length,
      3,
    );
  }));
test("grouped spending uses database totals for each category and currency", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "grouped" } }),
      category = await db.category.create({
        data: { userId: user.id, name: "Dining" },
      });
    const base = {
      userId: user.id,
      date: new Date("2026-08-02"),
      description: "Lunch",
      categoryId: category.id,
      currency: "SGD",
    };
    await db.transaction.createMany({
      data: [
        { ...base, amountOut: "0.1" },
        { ...base, amountOut: "0.2" },
        { ...base, currency: "USD", amountOut: "5" },
      ],
    });
    const result = await new ReadTools(db).summary(user.id, {
      dateFrom: "2026-08-01T00:00:00Z",
      dateTo: "2026-09-01T00:00:00Z",
      groupBy: "category",
    });
    assert.deepEqual(
      result.totals.map((t) => [t.group, t.currency, t.expense]),
      [
        ["Dining", "SGD", "0.30"],
        ["Dining", "USD", "5.00"],
      ],
    );
  }));
