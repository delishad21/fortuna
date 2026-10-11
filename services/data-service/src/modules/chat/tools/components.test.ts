import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "../test-harness";
import { ReadTools } from "./read";
import {
  ComponentTools,
  TRANSACTION_PREVIEW_ROWS,
  compactBlocks,
  componentForModel,
} from "./components";
import { SUBMITTED_REVIEW_TITLE } from "../contracts";
import { createToolRegistry } from "./registry";

const range = {
  dateFrom: "2026-08-01T00:00:00Z",
  dateTo: "2026-09-01T00:00:00Z",
};
async function seed(db: Parameters<Parameters<typeof withChatDb>[0]>[0]) {
  const user = await db.user.create({ data: { username: "components" } });
  const other = await db.user.create({ data: { username: "components-x" } });
  const food = await db.category.create({
    data: { userId: user.id, name: "Food", color: "#ff0000" },
  });
  const base = { userId: user.id, currency: "SGD", description: "Card" };
  await db.transaction.createMany({
    data: [
      ...Array.from({ length: 40 }, (_, i) => ({
        ...base,
        date: new Date(Date.UTC(2026, 7, 1 + (i % 28))),
        description: `Merchant ${i % 12}`,
        amountOut: "1.10",
        categoryId: i % 2 ? food.id : null,
      })),
      { ...base, date: new Date("2026-08-15T00:00:00Z"), amountIn: "500" },
      { ...base, date: new Date("2026-07-15T00:00:00Z"), amountOut: "10" },
      {
        ...base,
        currency: "USD",
        date: new Date("2026-08-03T00:00:00Z"),
        amountOut: "2.50",
      },
      {
        ...base,
        userId: other.id,
        date: new Date("2026-08-02"),
        amountOut: 99,
      },
    ],
  });
  return { user, tools: new ComponentTools(db, new ReadTools(db)) };
}

test("transaction lists embed a preview page and the full match count", () =>
  withChatDb(async (db) => {
    const { user, tools } = await seed(db);
    const block = await tools.show(user.id, {
      component: "transaction_list",
      title: "August",
      filters: { ...range, currency: "SGD" },
    });
    assert.equal(block.component, "transaction_list");
    if (block.component !== "transaction_list") return;
    assert.equal(block.total, 41);
    assert.equal(block.rows.length, TRANSACTION_PREVIEW_ROWS);
    const next = await new ReadTools(db).transactionPage(user.id, {
      ...block.query,
      offset: 40,
      limit: 100,
    });
    assert.equal(next.rows.length, 1);
    assert.equal(next.total, 41);
    const model = componentForModel(block, true) as any;
    assert.equal(model.firstRows.length, TRANSACTION_PREVIEW_ROWS);
    assert.equal((compactBlocks([block]) as any)[0].firstRows, undefined);
    assert.equal((compactBlocks([block]) as any)[0].total, 41);
  }));

test("summary tiles keep currencies separate and compare with the previous period", () =>
  withChatDb(async (db) => {
    const { user, tools } = await seed(db);
    const block = await tools.show(user.id, {
      component: "summary_tiles",
      title: "August",
      filters: range,
    });
    if (block.component !== "summary_tiles") return assert.fail();
    const sgd = block.currencies.find((c) => c.currency === "SGD")!;
    assert.deepEqual(
      { ...sgd, previous: undefined },
      {
        currency: "SGD",
        expense: "44.00",
        income: "500.00",
        net: "456.00",
        count: 41,
        previous: undefined,
      },
    );
    assert.equal(sgd.previous?.expense, "10.00");
    assert.equal(block.previousRange?.dateFrom, "2026-07-01T00:00:00.000Z");
    assert.equal(
      block.currencies.find((c) => c.currency === "USD")?.expense,
      "2.50",
    );
  }));

test("breakdowns rank the top groups, fold the rest into Other and colour categories", () =>
  withChatDb(async (db) => {
    const { user, tools } = await seed(db);
    const merchants = await tools.show(user.id, {
      component: "breakdown",
      title: "Merchants",
      filters: { ...range, currency: "SGD" },
      groupBy: "merchant",
      limit: 5,
    });
    if (merchants.component !== "breakdown") return assert.fail();
    const [sgd] = merchants.series;
    assert.equal(sgd.items.length, 6);
    assert.equal(sgd.items[5].other, true);
    assert.equal(sgd.items[5].name, "Other (7)");
    assert.equal(sgd.total, "44.00");
    const categories = await tools.show(user.id, {
      component: "breakdown",
      title: "Categories",
      filters: { ...range, currency: "SGD" },
    });
    if (categories.component !== "breakdown") return assert.fail();
    const food = categories.series[0].items.find((i) => i.name === "Food");
    assert.deepEqual([food?.amount, food?.color], ["22.00", "#ff0000"]);
  }));

test("trends zero-fill buckets and reject ranges with too many points", () =>
  withChatDb(async (db) => {
    const { user, tools } = await seed(db);
    const weekly = await tools.show(user.id, {
      component: "trend",
      title: "Weekly",
      filters: { ...range, currency: "SGD" },
      interval: "week",
    });
    if (weekly.component !== "trend") return assert.fail();
    const points = weekly.series[0].points;
    assert.equal(points[0].period, "2026-07-27");
    assert.equal(points.length, 6);
    const total = points.reduce((n, p) => n + Number(p.expense), 0);
    assert.equal(total.toFixed(2), "44.00");
    await assert.rejects(
      tools.show(user.id, {
        component: "trend",
        title: "Daily",
        filters: {
          dateFrom: "2020-01-01T00:00:00Z",
          dateTo: "2026-01-01T00:00:00Z",
        },
        interval: "day",
      }),
      /coarser interval/,
    );
  }));

test("read tools answer the model without displaying raw data", () =>
  withChatDb(async (db) => {
    const { user } = await seed(db);
    const registry = createToolRegistry(db);
    const context = { userId: user.id } as any;
    const found = await registry.execute(context, "find_transactions", range);
    assert.deepEqual(found.blocks, []);
    assert.equal((found.model as unknown[]).length, 30);
    const shown = await registry.execute(context, "show_component", {
      component: "summary_tiles",
      title: "August",
      filters: range,
    });
    assert.equal(shown.blocks[0].type, "component");
    assert.ok(registry.isReadOnly("show_component"));
  }));

test("submitted reviews replay as each row's changes, not two full payloads", () => {
  const metadata = { legs: ["06:15 PM Bus 145; $1.28"], parserId: "simplygo" };
  const staged = {
    date: "2026-09-02",
    description: "SimplyGo: Opp Blk 1 - Lakeside",
    amountIn: null,
    amountOut: 2.07,
    currency: "SGD",
    metadata,
  };
  const saved = { ...staged, label: "Bus", categoryId: "cat-1" };
  const [text, review] = compactBlocks([
    { type: "text", text: "Here is my completed review" },
    {
      type: "data",
      title: SUBMITTED_REVIEW_TITLE,
      data: {
        reviewId: "review-1",
        title: "Sep labels",
        rows: [
          {
            id: "row-1",
            version: 2,
            source: { draftId: "draft-1", rowId: "row-1" },
            original: staged,
            value: {
              ...staged,
              label: "MRT/Bus (Johan)",
              metadata: { ...metadata, assistantNote: "Commute" },
            },
            suggestion: { reason: "Commute", confidence: 0.84 },
          },
          {
            id: "tx-1",
            version: 1,
            source: { transactionId: "tx-1" },
            original: saved,
            value: saved,
          },
        ],
      },
    },
  ]) as any[];
  assert.equal(text.text, "Here is my completed review");
  assert.deepEqual(review.data, {
    reviewId: "review-1",
    title: "Sep labels",
    rows: [
      {
        stagedRowId: "row-1",
        draftId: "draft-1",
        date: "2026-09-02",
        description: "SimplyGo: Opp Blk 1 - Lakeside",
        amountOut: 2.07,
        currency: "SGD",
        changes: { label: "MRT/Bus (Johan)" },
      },
      {
        transactionId: "tx-1",
        date: "2026-09-02",
        description: "SimplyGo: Opp Blk 1 - Lakeside",
        amountOut: 2.07,
        currency: "SGD",
      },
    ],
  });
});
