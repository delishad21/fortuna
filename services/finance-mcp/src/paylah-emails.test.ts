import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paylahEmailGuide, paylahRowCounts, withPaylahHint } from "./paylah-emails.js";

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
  });

  it("counts unmatched payments and unhandled receipts only", () => {
    assert.deepEqual(paylahRowCounts([topUp, matchedPayment, maxOut, handledMaxOut]), { unmatchedTopUps: 1, unhandledMaxOuts: 1 });
  });

  it("ignores PayLah rows the user's rules marked internal", () => {
    assert.deepEqual(paylahRowCounts([internalTopUp]), { unmatchedTopUps: 0, unhandledMaxOuts: 0 });
    const response = { draft: { rows: [internalTopUp] } };
    assert.equal(withPaylahHint(response), response);
  });

  it("adds a hint only while PayLah rows remain", () => {
    assert.match(String((withPaylahHint({ draft: { rows: [topUp] } }) as { paylahHint?: string }).paylahHint), /get_paylah_email_guide/);
    assert.equal("paylahHint" in withPaylahHint({ draft: { rows: [matchedPayment, handledMaxOut] } }), false);
  });
});
