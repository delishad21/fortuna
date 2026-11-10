// Synthetic PayLah alert bodies for tests, laid out like DBS's real HTML: styles in the
// head, the ref in its own cell, and the details in a two-column table. Names, numbers
// and refs are made up.

export function alertHtml(o: {
  ref: string;
  kind: "your PayLah! Scan & Pay Transfer" | "your PayLah! Transfer" | "a PayNow Transfer";
  when: string;
  amount: string;
  to: string;
}) {
  const dated = o.when.split(" ").slice(0, 2).join(" ");
  return `<!DOCTYPE html><html><head><title>Transaction Alerts</title>
<style type="text/css">body { background-color: #ffffff; font-family: Arial; }
.text-link-1, .text-link-1:hover { color: #000000; }
@media only screen and (max-width: 480px) { body .fullsize { width: 100%; } }</style></head>
<body><center><table><tbody>
<!-- Start: Body Copy 1 -->
<tr><td class="contenttable" align="left">Problems viewing this email? Select "always display images".</td></tr>
<tr><td width="100%" class="contenttable" align="left"><br /> Transaction Ref: ${o.ref}</td></tr>
<tr><td width="100%" class="contenttable" align="left"><br /> Dear Sir / Madam, <br /> </td></tr>
<tr><td align="left" class="contenttable">We refer to ${o.kind} dated ${dated}. We are pleased to confirm that the transaction was completed. <br /> <br />
<table><tbody>
<tr><td>Date &amp; Time:</td><td>${o.when}</td></tr>
<tr><td>Amount:</td><td>${o.amount}</td></tr>
<tr><td>From:</td><td>PayLah! Wallet (Mobile ending 0000)</td></tr>
<tr><td>To:</td><td>${o.to}</td></tr>
</tbody></table>
<br /> To view your transactions, login to your PayLah! Wallet and select &ldquo;History&rdquo; at the bottom bar of the Home page. <br /><br />
Please call DBS hotline immediately if this was an unauthorised transaction. <br /> <br /> Thank you for banking with us.<br /> <br /> Yours faithfully<br /> DBS Bank Ltd <br /><br />This is an auto-generated message. Please do not reply to this email.&#8203;<br /> </td></tr>
</tbody></table></center></body></html>`;
}

export const scanAndPay = alertHtml({
  ref: "PLPE4626409400000001",
  kind: "your PayLah! Scan & Pay Transfer",
  when: "21 Sep 12:17 (SGT)",
  amount: "SGD4.50",
  to: "THE JUICE MAN MAN",
});

export const paylahTransfer = alertHtml({
  ref: "TF716201790600000002",
  kind: "your PayLah! Transfer",
  when: "29 Sep 12:21 (SGT)",
  amount: "SGD12.00",
  to: "dan (Mobile ending 1235)",
});

export const paynowTransfer = alertHtml({
  ref: "IP178944595900000003",
  kind: "a PayNow Transfer",
  when: "15 Sep 08:05 (SGT)",
  amount: "SGD1,250.00",
  to: "TAX WEX PENXX ANDXXX (Mobile ending 1712)",
});
