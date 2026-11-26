-- AI-first classification for assistant entries: rules apply by account or
-- card whatever the entry's source, carry their origin, reason, examples and
-- hit stats, and may have an amount range; entries carry open questions.

ALTER TABLE "import_rules"
  ADD COLUMN "account_id" TEXT,
  ADD COLUMN "card_id" TEXT,
  ADD COLUMN "amount_min" DECIMAL(12,2),
  ADD COLUMN "amount_max" DECIMAL(12,2),
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "example_transaction_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "recurring_bill" JSONB,
  ADD COLUMN "hit_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_hit_at" TIMESTAMP(3),
  ADD COLUMN "acknowledged_at" TIMESTAMP(3),
  ADD COLUMN "undone_at" TIMESTAMP(3);

ALTER TABLE "import_rules"
  ADD CONSTRAINT "import_rules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "import_rules_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "import_rules_user_id_origin_acknowledged_at_idx" ON "import_rules"("user_id", "origin", "acknowledged_at");

-- A rule scoped to a statement identifier is scoped to that identifier's account.
UPDATE "import_rules" r
SET "account_id" = n."account_id"
FROM "account_numbers" n
WHERE r."account_identifier" IS NOT NULL
  AND n."user_id" = r."user_id"
  AND n."account_number" = r."account_identifier"
  AND n."account_id" IS NOT NULL;

-- Hits so far: committed transactions a rule classified on import.
UPDATE "import_rules" r
SET "hit_count" = hits.count, "last_hit_at" = hits.last
FROM (
  SELECT "user_id", "metadata"->>'fixedRuleId' AS rule_id, COUNT(*)::INTEGER AS count, MAX("created_at") AS last
  FROM "transactions"
  WHERE "metadata"->>'fixedRuleId' IS NOT NULL
  GROUP BY 1, 2
) hits
WHERE hits."user_id" = r."user_id" AND hits.rule_id = r."id";

ALTER TABLE "transactions" ADD COLUMN "questions" JSONB NOT NULL DEFAULT '[]';
