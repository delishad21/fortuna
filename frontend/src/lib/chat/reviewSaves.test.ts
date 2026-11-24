import assert from "node:assert/strict";
import test from "node:test";
import { ReviewSaves } from "./reviewSaves";

const tick = () => new Promise((r) => setTimeout(r, 0));

function server() {
  const row = (id: string) => ({
    id,
    version: 1,
    source: { transactionId: id },
    original: {},
    value: { label: "", categoryId: null } as Record<string, any>,
  });
  const review = {
    id: "rv",
    conversationId: "c",
    title: "Sample",
    instructions: "",
    status: "pending",
    version: 1,
    rows: [row("a"), row("b")],
    categories: [],
    accounts: [],
  };
  const puts: any[] = [];
  /** Requests waiting for an answer, oldest first. */
  const held: Array<() => void> = [];
  const request = async (_path: string, options: any = {}) => {
    await new Promise<void>((resolve) => held.push(resolve));
    if (options.method === "PUT") {
      const target = review.rows.find((r) => r.id === options.body.rowId)!;
      puts.push(options.body);
      if (target.version !== options.body.version)
        throw new Error("This row changed on another device.");
      target.value = { ...target.value, ...options.body.patch };
      target.version++;
      review.version++;
    }
    return structuredClone(review);
  };
  const answer = async () => {
    await tick();
    held.shift()?.();
    await tick();
    await tick();
  };
  const saves = new ReviewSaves(request as any, "rv", () => {});
  return { review, puts, held, answer, saves };
}

async function opened() {
  const s = server();
  const loading = s.saves.load();
  await s.answer();
  await loading;
  return s;
}

test("two edits to one row are saved in order on its latest version", async () => {
  const s = await opened();
  s.saves.update(0, "label", "First");
  await tick();
  s.saves.update(0, "label", "Second");
  s.saves.update(0, "categoryId", "dining");
  assert.equal(s.saves.review!.rows[0].value.label, "Second");
  await s.answer();
  // The first response does not bring back the older text.
  assert.equal(s.saves.review!.rows[0].value.label, "Second");
  await s.answer();
  await s.saves.idle();
  assert.deepEqual(s.puts, [
    { rowId: "a", version: 1, patch: { label: "First" } },
    {
      rowId: "a",
      version: 2,
      patch: { label: "Second", categoryId: "dining" },
    },
  ]);
  assert.equal(s.saves.pending, 0);
  assert.equal(s.saves.error, "");
});

test("a poll that overlaps an edit is ignored", async () => {
  const s = await opened();
  const poll = s.saves.load();
  await tick();
  s.saves.update(0, "label", "Typed");
  await tick();
  // The PUT is answered first, the older poll after it.
  s.held.reverse();
  await s.answer();
  await s.answer();
  await poll;
  assert.equal(s.saves.review!.rows[0].value.label, "Typed");
  assert.equal(s.saves.review!.rows[0].version, 2);
});

test("a conflict keeps its error, drops that row's later edits and saves other rows", async () => {
  const s = await opened();
  s.review.rows[0].value.label = "Phone";
  s.review.rows[0].version = 2;
  s.saves.update(0, "label", "Mine");
  await tick();
  s.saves.update(1, "label", "Other");
  s.saves.update(0, "categoryId", "dining");
  await s.answer(); // refused
  await s.answer(); // reads the review again
  await s.answer(); // the other row
  await s.saves.idle();
  assert.match(s.saves.error, /another device/);
  assert.equal(s.saves.review!.rows[0].value.label, "Phone");
  assert.equal(s.saves.review!.rows[0].value.categoryId, null);
  assert.equal(s.saves.review!.rows[1].value.label, "Other");
  assert.equal(s.puts.length, 2);
  const reload = s.saves.reload();
  await s.answer();
  await reload;
  assert.equal(s.saves.error, "");
});

test("a queued edit doesn't overwrite the same field changed elsewhere, but keeps other fields", async () => {
  const s = await opened();
  s.saves.update(0, "label", "A");
  await tick();
  s.saves.update(1, "label", "B");
  s.review.rows[1].value.label = "Phone";
  s.review.rows[1].version = 2;
  await s.answer();
  await s.answer();
  await s.answer();
  await s.saves.idle();
  assert.match(s.saves.error, /another device/);
  assert.equal(s.saves.review!.rows[1].value.label, "Phone");

  const t = await opened();
  t.saves.update(0, "label", "A");
  await tick();
  t.saves.update(1, "label", "B");
  t.review.rows[1].value.categoryId = "dining";
  t.review.rows[1].version = 2;
  await t.answer();
  await t.answer();
  await t.saves.idle();
  assert.equal(t.saves.error, "");
  assert.deepEqual(t.saves.review!.rows[1].value, {
    label: "B",
    categoryId: "dining",
  });
});

test("a closed review takes no edits", async () => {
  const s = await opened();
  s.saves.accept({ ...s.saves.review!, status: "submitted" });
  s.saves.update(0, "label", "Late");
  assert.equal(s.saves.pending, 0);
  assert.equal(s.saves.review!.rows[0].value.label, "");
});
