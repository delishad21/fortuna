import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paylahEmailGuide, paylahHint, paylahRowCounts } from "./paylah-emails";

const topUp = { currentPayload: { description: "Advice Funds Transfer TOP-UP TO PAYLAH! : 96317826", linkage: null, metadata: {} } };
const matchedPayment = {
  currentPayload: { description: "THE JUICE MAN MAN", linkage: null, metadata: { emailTransactionRef: "PLPE4627309530070986", paymentChannel: "PayLah" } },
};
const maxOut = { currentPayload: { description: "Advice Funds Transfer MAXED OUT FROM PAYLAH! : MADELINE", linkage: { type: "reimbursement" }, metadata: {} } };
const handledMaxOut = { currentPayload: { ...maxOut.currentPayload, metadata: { paymentChannel: "PayLah" } } };
const internalTopUp = { currentPayload: { ...topUp.currentPayload, linkage: { type: "internal" } } };

describe("PayLah email guide", () => {
  it("keeps amounts on the bank row and reads the SGT time from the body", () => {
    const guide = paylahEmailGuide();
    assert.equal(guide.emails.from, "paylah.alert@dbs.com");
    assert.match(guide.payments.payload, /Never change date, amountIn, amountOut/);
    assert.match(guide.emails.fields.dateTime, /not the email header/);
    assert.match(guide.preconditions.join(" "), /internal/);
    assert.match(guide.neverDo.join(" "), /Never commit the draft/);
  });

  it("gives each agent its own tool names and the same matching rules", () => {
    const mcp = paylahEmailGuide("mcp");
    const chat = paylahEmailGuide("chat");
    assert.equal(mcp.payments.tool, "update_import_draft_row");
    assert.equal(chat.payments.tool, "update_staged_rows");
    assert.deepEqual(chat.matching, mcp.matching);
    assert.deepEqual(chat.payments.metadata, mcp.payments.metadata);
    assert.match(JSON.stringify(chat), /search_paylah_emails/);
    assert.match(JSON.stringify(chat), /find_similar_transactions/);
    assert.match(JSON.stringify(chat), /get_reimbursement_candidates/);
    assert.match(JSON.stringify(mcp), /get_ledger_reimbursement_candidates/);
    for (const mcpOnly of ["get_ledger_reimbursement_candidates", "update_import_draft_row"])
      assert.equal(JSON.stringify(chat).includes(mcpOnly), false, `${mcpOnly} is not a chat tool`);
  });

  it("counts unmatched payments and unhandled receipts only", () => {
    assert.deepEqual(paylahRowCounts([topUp, matchedPayment, maxOut, handledMaxOut]), { unmatchedTopUps: 1, unhandledMaxOuts: 1 });
  });

  it("ignores PayLah rows the user's rules marked internal", () => {
    assert.deepEqual(paylahRowCounts([internalTopUp]), { unmatchedTopUps: 0, unhandledMaxOuts: 0 });
    assert.deepEqual(paylahHint([internalTopUp]), {});
  });

  it("adds a hint only while PayLah rows remain", () => {
    assert.match(String(paylahHint([topUp]).paylahHint), /get_paylah_email_guide/);
    assert.match(String(paylahHint([topUp], "chat").paylahHint), /connected Gmail/);
    assert.deepEqual(paylahHint([matchedPayment, handledMaxOut]), {});
  });
});
