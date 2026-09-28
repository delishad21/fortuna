import { test } from "node:test";
import assert from "node:assert/strict";
import { safeChatError } from "./errors";
import { ChatError } from "./contracts";
test("domain input errors explain recovery but infrastructure details remain private", () => {
  assert.equal(
    safeChatError(
      Object.assign(new Error("Statement expired. Upload it again."), {
        status: 404,
      }),
    ),
    "Statement expired. Upload it again.",
  );
  assert.equal(
    safeChatError(
      new ChatError(429, "Provider rate limit reached. Try again shortly."),
    ),
    "Provider rate limit reached. Try again shortly.",
  );
  assert.equal(
    safeChatError(new Error("/private/storage/file not found")),
    null,
  );
  assert.equal(
    safeChatError(
      Object.assign(new Error("database password is wrong"), { status: 500 }),
    ),
    null,
  );
});
