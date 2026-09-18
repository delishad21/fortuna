import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parserAuthoringGuide } from "./parser-authoring.js";

describe("parser authoring guide", () => {
  it("documents the exact amount contract and supported PDF path", () => {
    const guide = parserAuthoringGuide("/srv/fortuna/inbox");
    assert.equal(guide.statementInbox, "/srv/fortuna/inbox");
    assert.match(guide.pythonContract.directionRule, /amountIn.*amountOut/);
    assert.match(guide.pdfTemplate, /pdfplumber\.open\(io\.BytesIO\(content\)\)/);
    assert.ok(guide.pythonContract.allowedImports.includes("pdfplumber"));
    assert.match(guide.pythonContract.requiredForBankStatements.accountIdentifier, /every transaction/);
    assert.match(guide.rules.join(" "), /accountIdentifier/);
  });
});
