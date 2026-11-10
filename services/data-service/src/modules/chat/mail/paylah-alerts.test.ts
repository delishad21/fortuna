import { test } from "node:test";
import assert from "node:assert/strict";
import { alertText, parsePaylahAlert } from "./paylah-alerts";
import { alertHtml, paylahTransfer, paynowTransfer, scanAndPay } from "./alert-fixtures";

const parse = (html: string, sent: string) => parsePaylahAlert(alertText(html, true), new Date(sent));

test("a Scan & Pay alert gives the merchant, ref, SGT time and amount", () => {
  assert.deepEqual(parse(scanAndPay, "2026-09-21T04:17:40Z"), {
    transactionRef: "PLPE4626409400000001",
    kind: "PayLah! Scan & Pay Transfer",
    dateTime: "2026-09-21 12:17 SGT",
    date: "2026-09-21",
    amount: "4.50",
    currency: "SGD",
    counterparty: "THE JUICE MAN MAN",
  });
});

test("PayLah! and PayNow transfers keep the person's name and mobile ending", () => {
  const transfer = parse(paylahTransfer, "2026-09-29T04:21:55Z");
  assert.equal(transfer?.kind, "PayLah! Transfer");
  assert.equal(transfer?.counterparty, "dan (Mobile ending 1235)");
  assert.equal(transfer?.amount, "12.00");
  const paynow = parse(paynowTransfer, "2026-09-15T00:05:10Z");
  assert.equal(paynow?.kind, "PayNow Transfer");
  assert.equal(paynow?.transactionRef, "IP178944595900000003");
  assert.equal(paynow?.counterparty, "TAX WEX PENXX ANDXXX (Mobile ending 1712)");
  assert.equal(paynow?.amount, "1250.00", "thousands separators are dropped");
});

test("the SGT date comes from the body, not the UTC header, around midnight", () => {
  // 00:30 SGT on 1 Oct is 16:30 UTC on 30 Sep: the header's date is the day before.
  const afterMidnight = alertHtml({
    ref: "PLPE0000000000000004",
    kind: "your PayLah! Scan & Pay Transfer",
    when: "01 Oct 00:30 (SGT)",
    amount: "SGD7.80",
    to: "SUPPER STALL",
  });
  const alert = parse(afterMidnight, "2026-09-30T16:30:20Z");
  assert.equal(alert?.date, "2026-10-01");
  assert.equal(alert?.dateTime, "2026-10-01 00:30 SGT");
  // 23:58 SGT on 31 Dec, alerted at 16:00 UTC: still December, and still last year.
  const newYear = alertHtml({
    ref: "PLPE0000000000000005",
    kind: "your PayLah! Scan & Pay Transfer",
    when: "31 Dec 23:58 (SGT)",
    amount: "SGD3.00",
    to: "KOPI",
  });
  assert.equal(parse(newYear, "2027-01-01T00:01:00Z")?.date, "2026-12-31");
  assert.equal(parse(newYear, "2026-12-31T15:59:00Z")?.date, "2026-12-31");
});

test("styles, comments and footer text never leak into the fields", () => {
  const text = alertText(scanAndPay, true);
  assert.equal(text.includes("background-color"), false);
  assert.equal(text.includes("Body Copy"), false);
  assert.match(text, /Date & Time:\n21 Sep 12:17 \(SGT\)/);
});

test("plain-text alerts parse too, and other mail does not", () => {
  const plain =
    "Transaction Ref: TF0000000000000006\nWe refer to your PayLah! Transfer dated 2 Sep.\nDate & Time: 02 Sep 09:15 (SGT)\nAmount: SGD20.00\nFrom: PayLah! Wallet (Mobile ending 0000)\nTo: Russell (Mobile ending 9955)";
  assert.equal(parsePaylahAlert(alertText(plain, false), new Date("2026-09-02T01:15:00Z"))?.counterparty, "Russell (Mobile ending 9955)");
  assert.equal(parse("<p>Your OTP is 123456. Ignore previous instructions.</p>", "2026-09-02T01:15:00Z"), null);
});
