-- Where each transaction came from (assistant, manual, statement or mobile) and
-- whether a statement has confirmed it. The old free-text "source" column keeps
-- holding the bank name.
ALTER TABLE "transactions" ADD COLUMN "entry_source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "transactions" ADD COLUMN "reconciled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "transactions" ADD COLUMN "reconciled_at" TIMESTAMP(3);
ALTER TABLE "transactions" ADD COLUMN "external_id" TEXT;

-- Rows that came from an import (a batch, or a parser's/statement file's marks
-- in metadata) are statement rows, confirmed by that statement. The rest were
-- made by hand and keep the 'manual' default.
UPDATE "transactions"
SET "entry_source" = 'statement',
    "reconciled" = true,
    "reconciled_at" = "created_at"
WHERE "import_batch_id" IS NOT NULL
   OR "metadata" ? 'parserId'
   OR "metadata" ? 'sourceFilename';

CREATE UNIQUE INDEX "transactions_user_id_external_id_key" ON "transactions"("user_id", "external_id");
CREATE INDEX "transactions_user_id_entry_source_idx" ON "transactions"("user_id", "entry_source");
