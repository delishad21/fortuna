-- Optional account scope for import rules; NULL keeps the existing any-account behaviour.
ALTER TABLE "import_rules" ADD COLUMN "account_identifier" TEXT;
