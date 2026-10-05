-- Reimbursement links move out of transactions.linkage JSON into their own table.
-- Each end of a link is a saved transaction or a staged import row, never both.
-- Every statement is idempotent so the migration can run ahead of a deploy.

CREATE TABLE IF NOT EXISTS "reimbursement_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reimbursement_transaction_id" TEXT,
    "reimbursement_draft_row_id" TEXT,
    "expense_transaction_id" TEXT,
    "expense_draft_row_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reimbursement_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reimbursement_links_user_id_idx" ON "reimbursement_links"("user_id");
CREATE INDEX IF NOT EXISTS "reimbursement_links_reimbursement_transaction_id_idx" ON "reimbursement_links"("reimbursement_transaction_id");
CREATE INDEX IF NOT EXISTS "reimbursement_links_expense_transaction_id_idx" ON "reimbursement_links"("expense_transaction_id");
CREATE INDEX IF NOT EXISTS "reimbursement_links_reimbursement_draft_row_id_idx" ON "reimbursement_links"("reimbursement_draft_row_id");
CREATE INDEX IF NOT EXISTS "reimbursement_links_expense_draft_row_id_idx" ON "reimbursement_links"("expense_draft_row_id");

-- One link per reimbursement-expense pair, whichever kind each end is.
CREATE UNIQUE INDEX IF NOT EXISTS "reimbursement_links_pair_key" ON "reimbursement_links"(
    (COALESCE("reimbursement_transaction_id", "reimbursement_draft_row_id")),
    (COALESCE("expense_transaction_id", "expense_draft_row_id"))
);

DO $$ BEGIN
  ALTER TABLE "reimbursement_links" ADD CONSTRAINT "reimbursement_links_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reimbursement_links" ADD CONSTRAINT "reimbursement_links_reimbursement_transaction_id_fkey"
    FOREIGN KEY ("reimbursement_transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reimbursement_links" ADD CONSTRAINT "reimbursement_links_expense_transaction_id_fkey"
    FOREIGN KEY ("expense_transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reimbursement_links" ADD CONSTRAINT "reimbursement_links_reimbursement_draft_row_id_fkey"
    FOREIGN KEY ("reimbursement_draft_row_id") REFERENCES "import_draft_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reimbursement_links" ADD CONSTRAINT "reimbursement_links_expense_draft_row_id_fkey"
    FOREIGN KEY ("expense_draft_row_id") REFERENCES "import_draft_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reimbursement_links" ADD CONSTRAINT "reimbursement_links_one_reimbursement_end"
    CHECK (num_nonnulls("reimbursement_transaction_id", "reimbursement_draft_row_id") = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reimbursement_links" ADD CONSTRAINT "reimbursement_links_one_expense_end"
    CHECK (num_nonnulls("expense_transaction_id", "expense_draft_row_id") = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reimbursement_links" ADD CONSTRAINT "reimbursement_links_positive_amount"
    CHECK ("amount" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reimbursement_links" ADD CONSTRAINT "reimbursement_links_not_self"
    CHECK (COALESCE("reimbursement_transaction_id", "reimbursement_draft_row_id")
           <> COALESCE("expense_transaction_id", "expense_draft_row_id"));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- JSON numbers can arrive as strings; anything that is not a plain number counts as 0.
CREATE OR REPLACE FUNCTION pg_temp.rl_num(value TEXT) RETURNS NUMERIC AS $$
  SELECT CASE
    WHEN value ~ '^\s*-?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?\s*$' THEN value::NUMERIC
    ELSE 0
  END
$$ LANGUAGE SQL IMMUTABLE;

-- Saved links, from the reimbursement side (the old source of truth). Links whose
-- expense is gone, is not money out, or is internal/a reimbursement are dropped.
-- Amounts are clamped so no reimbursement or expense is over-allocated.
WITH alloc AS (
  SELECT r.id AS rid,
         r.user_id,
         a->>'transactionId' AS eid,
         SUM(GREATEST(pg_temp.rl_num(a->>'amount'), 0)) AS amount
  FROM "transactions" r
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.linkage->'reimbursesAllocations') = 'array'
         THEN r.linkage->'reimbursesAllocations' ELSE '[]'::jsonb END
  ) a
  WHERE r.linkage->>'type' = 'reimbursement'
    AND COALESCE(r.amount_in, 0) > 0
    AND COALESCE(a->>'transactionId', '') <> ''
  GROUP BY r.id, r.user_id, a->>'transactionId'
), valid AS (
  SELECT al.rid, al.user_id, al.eid, al.amount, r.amount_in, e.amount_out, e.date AS edate
  FROM alloc al
  JOIN "transactions" r ON r.id = al.rid
  JOIN "transactions" e ON e.id = al.eid AND e.user_id = al.user_id
  WHERE al.eid <> al.rid
    AND al.amount > 0
    AND COALESCE(e.amount_out, 0) > 0
    AND COALESCE(e.linkage->>'type', '') NOT IN ('internal', 'reimbursement')
), r_clamped AS (
  SELECT v.*,
         LEAST(v.amount, GREATEST(v.amount_in - (SUM(v.amount) OVER (PARTITION BY v.rid ORDER BY v.edate, v.eid) - v.amount), 0)) AS r_amount
  FROM valid v
), e_clamped AS (
  SELECT c.*,
         LEAST(c.r_amount, GREATEST(c.amount_out - (SUM(c.r_amount) OVER (PARTITION BY c.eid ORDER BY c.rid) - c.r_amount), 0)) AS final_amount
  FROM r_clamped c
)
INSERT INTO "reimbursement_links" ("id", "user_id", "amount", "reimbursement_transaction_id", "expense_transaction_id", "created_at", "updated_at")
SELECT 'rl' || substr(md5(rid || ':' || eid), 1, 23), user_id, ROUND(final_amount, 2), rid, eid, NOW(), NOW()
FROM e_clamped
WHERE ROUND(final_amount, 2) > 0
ON CONFLICT DO NOTHING;

-- Staged links, from reimbursement rows in open main-ledger drafts.
DROP TABLE IF EXISTS pg_temp.rl_staged_alloc;
CREATE TEMP TABLE rl_staged_alloc AS
SELECT r.id AS rid,
       r.draft_id,
       d.user_id,
       a->>'transactionId' AS target_tx,
       a->>'stagedRowId' AS target_row,
       CASE WHEN jsonb_typeof(a->'pendingBatchIndex') = 'number' THEN (a->>'pendingBatchIndex')::INT END AS target_index,
       GREATEST(pg_temp.rl_num(a->>'amount'), 0) AS amount
FROM "import_draft_rows" r
JOIN "import_drafts" d ON d.id = r.draft_id
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(r.current_payload->'linkage'->'reimbursesAllocations') = 'array'
       THEN r.current_payload->'linkage'->'reimbursesAllocations' ELSE '[]'::jsonb END
) a
WHERE d.mode = 'main'
  AND d.status NOT IN ('committed', 'discarded', 'expired')
  AND r.current_payload->'linkage'->>'type' = 'reimbursement';

-- Staged reimbursement -> staged expense (by row id, or by row position in the same draft).
INSERT INTO "reimbursement_links" ("id", "user_id", "amount", "reimbursement_draft_row_id", "expense_draft_row_id", "created_at", "updated_at")
SELECT 'rl' || substr(md5(s.rid || ':' || e.id), 1, 23), s.user_id, ROUND(SUM(s.amount), 2), s.rid, e.id, NOW(), NOW()
FROM rl_staged_alloc s
JOIN "import_draft_rows" e
  ON (s.target_row IS NOT NULL AND e.id = s.target_row)
  OR (s.target_row IS NULL AND s.target_tx IS NULL AND s.target_index IS NOT NULL
      AND e.draft_id = s.draft_id AND e.row_index = s.target_index)
JOIN "import_drafts" ed ON ed.id = e.draft_id AND ed.user_id = s.user_id
WHERE e.id <> s.rid
  AND ed.mode = 'main'
  AND ed.status NOT IN ('committed', 'discarded', 'expired')
  AND s.amount > 0
GROUP BY s.rid, s.user_id, e.id
HAVING ROUND(SUM(s.amount), 2) > 0
ON CONFLICT DO NOTHING;

-- Staged reimbursement -> saved expense.
INSERT INTO "reimbursement_links" ("id", "user_id", "amount", "reimbursement_draft_row_id", "expense_transaction_id", "created_at", "updated_at")
SELECT 'rl' || substr(md5(s.rid || ':' || e.id), 1, 23), s.user_id, ROUND(SUM(s.amount), 2), s.rid, e.id, NOW(), NOW()
FROM rl_staged_alloc s
JOIN "transactions" e ON e.id = s.target_tx AND e.user_id = s.user_id
WHERE s.target_row IS NULL
  AND s.amount > 0
  AND COALESCE(e.amount_out, 0) > 0
GROUP BY s.rid, s.user_id, e.id
HAVING ROUND(SUM(s.amount), 2) > 0
ON CONFLICT DO NOTHING;

-- Staged rows no longer carry link data; it is attached from the table when read.
UPDATE "import_draft_rows" r
SET current_payload = jsonb_set(
      r.current_payload,
      '{linkage}',
      (r.current_payload->'linkage') - 'reimbursesAllocations' - 'reimbursedByAllocations' - 'leftoverAmount'
    )
FROM "import_drafts" d
WHERE d.id = r.draft_id
  AND d.status NOT IN ('committed', 'discarded', 'expired')
  AND jsonb_typeof(r.current_payload->'linkage') = 'object'
  AND r.current_payload->'linkage'->>'type' <> 'reimbursed'
  AND (r.current_payload->'linkage') ?| ARRAY['reimbursesAllocations', 'reimbursedByAllocations', 'leftoverAmount'];

UPDATE "import_draft_rows" r
SET current_payload = jsonb_set(r.current_payload, '{linkage}', 'null'::jsonb)
FROM "import_drafts" d
WHERE d.id = r.draft_id
  AND d.status NOT IN ('committed', 'discarded', 'expired')
  AND r.current_payload->'linkage'->>'type' = 'reimbursed';

DROP TABLE IF EXISTS pg_temp.rl_staged_alloc;
DROP FUNCTION IF EXISTS pg_temp.rl_num(TEXT);
