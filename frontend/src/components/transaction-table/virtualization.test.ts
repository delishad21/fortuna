import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowTablePreparingState } from "./virtualization";

test("shows table preparation state only for large review tables", () => {
  assert.equal(shouldShowTablePreparingState(50, false), false);
  assert.equal(shouldShowTablePreparingState(250, false), true);
  assert.equal(shouldShowTablePreparingState(250, true), false);
});
