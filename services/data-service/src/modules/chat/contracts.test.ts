import { test } from "node:test";
import assert from "node:assert/strict";
import { submitMessageSchema, decisionSchema } from "./contracts";
const message = {
  text: "How much did I spend?",
  idempotencyKey: "msg-001",
  attachmentIds: [],
};
test("message cannot assert an owner or grant approval", () => {
  assert.equal(submitMessageSchema.safeParse(message).success, true);
  for (const injected of [
    { userId: "other" },
    { confirmed: true },
    { role: "system" },
  ]) {
    assert.equal(
      submitMessageSchema.safeParse({ ...message, ...injected }).success,
      false,
    );
  }
});
test("message must have text or attachments and be bounded", () => {
  assert.equal(
    submitMessageSchema.safeParse({ ...message, text: "  " }).success,
    false,
  );
  assert.equal(
    submitMessageSchema.safeParse({
      ...message,
      text: "",
      attachmentIds: ["file-1"],
    }).success,
    true,
  );
  assert.equal(
    submitMessageSchema.safeParse({ ...message, text: "x".repeat(16001) })
      .success,
    false,
  );
  assert.equal(
    submitMessageSchema.safeParse({ ...message, attachmentIds: ["a", "a"] })
      .success,
    false,
  );
});
test("approval cannot replace the stored action payload", () => {
  assert.equal(
    decisionSchema.safeParse({ decision: "approve", duplicateOverride: false })
      .success,
    true,
  );
  assert.equal(
    decisionSchema.safeParse({ decision: "approve", patch: { amountOut: 0 } })
      .success,
    false,
  );
});
