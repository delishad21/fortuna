-- Statement files are kept until the user deletes them: no expiry, and every file
-- counts as kept. Files already deleted stay deleted. The columns stay so an older
-- build still reads them.
ALTER TABLE "statement_files" ALTER COLUMN "expires_at" DROP NOT NULL;
ALTER TABLE "statement_files" ALTER COLUMN "retained" SET DEFAULT true;
UPDATE "statement_files" SET "expires_at" = NULL, "retained" = true WHERE "deleted_at" IS NULL;

DROP INDEX IF EXISTS "statement_files_user_id_expires_at_idx";
CREATE INDEX "statement_files_user_id_created_at_idx" ON "statement_files"("user_id", "created_at");
