import { test } from "node:test";
import assert from "node:assert/strict";
import { compatibleImportRuleParserIds } from "./transactions.service";

test("treats legacy and current PayLah parser IDs as fixed-rule aliases", () => {
  assert.deepEqual(compatibleImportRuleParserIds("dbs_paylah_statement"), [
    "dbs_paylah_statement",
    "dbs_paylah_statement_new",
  ]);
  assert.deepEqual(compatibleImportRuleParserIds("dbs_paylah_statement_new"), [
    "dbs_paylah_statement",
    "dbs_paylah_statement_new",
  ]);
});

test("keeps unrelated parser rule scopes exact", () => {
  assert.deepEqual(compatibleImportRuleParserIds("dbs_posb_consolidated"), [
    "dbs_posb_consolidated",
  ]);
  assert.deepEqual(compatibleImportRuleParserIds(), []);
});
