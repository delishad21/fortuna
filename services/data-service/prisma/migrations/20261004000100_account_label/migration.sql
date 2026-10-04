-- Optional friendly name shown alongside the account identifier.
-- IF NOT EXISTS lets the column be added ahead of a deploy without breaking this migration.
ALTER TABLE "account_numbers" ADD COLUMN IF NOT EXISTS "label" TEXT;
