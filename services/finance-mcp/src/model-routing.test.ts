import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recommendModelRoute } from "./model-routing.js";

describe("Hermes finance model routing", () => {
  it("uses Luna xhigh for ordinary classification and config parsers", () => {
    assert.equal(recommendModelRoute({ taskType: "classification" }).model, "gpt-5.6-luna");
    assert.equal(recommendModelRoute({ taskType: "config_parser" }).model, "gpt-5.6-luna");
  });

  it("escalates ambiguous config and code parser work", () => {
    assert.equal(recommendModelRoute({ taskType: "config_parser", reconciliationFailed: true }).model, "gpt-5.6-terra");
    assert.equal(recommendModelRoute({ taskType: "python_parser", ambiguousLayout: true }).model, "gpt-5.6-sol");
  });
});
