import assert from "node:assert/strict";
import test from "node:test";
import {
  resizeTextareaToContent,
  shouldShowTablePreparingState,
} from "./virtualization";

test("shows table preparation state only for large review tables", () => {
  assert.equal(shouldShowTablePreparingState(50, false), false);
  assert.equal(shouldShowTablePreparingState(250, false), true);
  assert.equal(shouldShowTablePreparingState(250, true), false);
});

test("resizes a textarea to its scroll height", () => {
  const textarea = {
    scrollHeight: 84,
    style: { height: "44px" },
  };

  const didResize = resizeTextareaToContent(textarea);

  assert.equal(textarea.style.height, "84px");
  assert.equal(didResize, true);
});

test("does not report a resize when textarea height is already current", () => {
  const textarea = {
    scrollHeight: 84,
    style: { height: "84px" },
  };

  const didResize = resizeTextareaToContent(textarea);

  assert.equal(textarea.style.height, "84px");
  assert.equal(didResize, false);
});
