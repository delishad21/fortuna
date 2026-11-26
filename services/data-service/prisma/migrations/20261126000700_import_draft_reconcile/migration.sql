-- A staged statement reconciles against entries already logged for its
-- account. Matches are worked out on read; only what the user chose by hand is
-- stored: { rows: { rowId: transactionId | null }, entries: { transactionId: { action, accountId } } }.
ALTER TABLE "import_drafts" ADD COLUMN "reconcile_overrides" JSONB;
