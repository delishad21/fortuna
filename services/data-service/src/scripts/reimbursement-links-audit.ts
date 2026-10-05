/**
 * Report drift between reimbursement links and the cached linkage JSON.
 *
 *   node dist/scripts/reimbursement-links-audit.js            # report only
 *   node dist/scripts/reimbursement-links-audit.js --fix      # repair
 *   node dist/scripts/reimbursement-links-audit.js --user=ID  # one user
 *
 * Legacy JSON links that never reached the links table are reported, not fixed.
 * Run the report before --fix: repairing rebuilds the JSON and hides them.
 */
import prisma from "../lib/prisma";
import { auditLinks } from "../modules/reimbursements/links.queries";

async function main() {
  const fix = process.argv.includes("--fix");
  const userArg = process.argv.find((arg) => arg.startsWith("--user="));
  const result = await auditLinks({
    userId: userArg ? userArg.slice("--user=".length) : undefined,
    fix,
  });
  console.log(JSON.stringify({ fix, counts: result.counts, findings: result.findings }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
