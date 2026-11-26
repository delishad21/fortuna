-- Accounts, cards and images.
--
-- Until now an account was only the identifier read off a statement
-- (account_numbers, transactions.account_number). This adds real accounts with
-- cards under them, maps every identifier to an account, and gives
-- transactions an account_id and optional card_id kept in step with
-- account_number by triggers, so every existing write path (imports, chat,
-- edits) keeps working unchanged. Images live in files on disk; the images
-- table only holds their metadata.

CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "images_user_id_sha256_key" ON "images"("user_id", "sha256");
ALTER TABLE "images" ADD CONSTRAINT "images_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "institution" TEXT,
    "type" TEXT NOT NULL DEFAULT 'other',
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "image_id" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "auto_created" BOOLEAN NOT NULL DEFAULT false,
    "auto_created_from" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "financial_accounts_type_check" CHECK ("type" IN ('savings', 'current', 'credit_card', 'other'))
);
CREATE INDEX "financial_accounts_user_id_idx" ON "financial_accounts"("user_id");
CREATE INDEX "financial_accounts_user_id_auto_created_idx" ON "financial_accounts"("user_id", "auto_created");
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "last4" VARCHAR(4) NOT NULL,
    "network" TEXT,
    "nickname" TEXT,
    "image_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cards_last4_check" CHECK ("last4" ~ '^[0-9]{4}$')
);
CREATE INDEX "cards_user_id_last4_idx" ON "cards"("user_id", "last4");
CREATE UNIQUE INDEX "cards_account_id_last4_key" ON "cards"("account_id", "last4");
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cards" ADD CONSTRAINT "cards_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cards" ADD CONSTRAINT "cards_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "account_numbers" ADD COLUMN "account_id" TEXT;
ALTER TABLE "transactions" ADD COLUMN "account_id" TEXT,
ADD COLUMN "card_id" TEXT,
ADD COLUMN "image_id" TEXT;

-- Identifiers used by transactions but never saved get a row, so every
-- transaction with an identifier ends up with an account.
INSERT INTO "account_numbers" ("id", "user_id", "account_number", "color", "created_at", "updated_at")
SELECT gen_random_uuid()::text, t."user_id", t."account_number", '#6366f1', MIN(t."created_at"), CURRENT_TIMESTAMP
FROM "transactions" t
WHERE t."account_number" IS NOT NULL AND btrim(t."account_number") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "account_numbers" a
    WHERE a."user_id" = t."user_id" AND a."account_number" = t."account_number"
  )
GROUP BY t."user_id", t."account_number";

-- One account per identifier, keeping its label (as the name) and colour.
-- Identifiers that look like a card (a label saying "credit", or a masked
-- number) become credit card accounts, with a card for their last 4 digits.
UPDATE "account_numbers" SET "account_id" = gen_random_uuid()::text WHERE "account_id" IS NULL;

-- Identifiers the assistant created (auto_created, from the transaction
-- review migration) give accounts that still need review; the flag and what
-- created the account live on the account from now on.
INSERT INTO "financial_accounts" ("id", "user_id", "name", "type", "color", "auto_created", "auto_created_from", "created_at", "updated_at")
SELECT a."account_id", a."user_id",
       COALESCE(NULLIF(btrim(a."label"), ''), a."account_number"),
       CASE WHEN a."label" ~* 'credit' OR a."account_number" LIKE '%*%' THEN 'credit_card' ELSE 'other' END,
       CASE WHEN a."color" ~ '^#[0-9a-fA-F]{6}$' THEN a."color" ELSE '#6366f1' END,
       a."auto_created", a."auto_created_from",
       a."created_at", CURRENT_TIMESTAMP
FROM "account_numbers" a;

INSERT INTO "cards" ("id", "user_id", "account_id", "last4", "network", "created_at", "updated_at")
SELECT gen_random_uuid()::text, a."user_id", a."account_id", right(a."account_number", 4),
       CASE left(a."account_number", 1) WHEN '4' THEN 'visa' WHEN '5' THEN 'mastercard' WHEN '3' THEN 'amex' END,
       a."created_at", CURRENT_TIMESTAMP
FROM "account_numbers" a
JOIN "financial_accounts" f ON f."id" = a."account_id"
WHERE f."type" = 'credit_card' AND a."account_number" ~ '[0-9]{4}$' AND a."account_number" LIKE '%*%';

ALTER TABLE "account_numbers" DROP COLUMN "auto_created", DROP COLUMN "auto_created_from";

UPDATE "transactions" t
SET "account_id" = a."account_id"
FROM "account_numbers" a
WHERE a."user_id" = t."user_id" AND a."account_number" = t."account_number";

CREATE INDEX "account_numbers_account_id_idx" ON "account_numbers"("account_id");
CREATE INDEX "transactions_account_id_idx" ON "transactions"("account_id");
CREATE INDEX "transactions_card_id_idx" ON "transactions"("card_id");
CREATE INDEX "transactions_image_id_idx" ON "transactions"("image_id");
ALTER TABLE "account_numbers" ADD CONSTRAINT "account_numbers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An identifier saved without an account (an import naming a new account, the
-- chat's settings tool) gets a new account named after it. Accounts for
-- unmatched assistant entries are created by the app, flagged auto_created.
CREATE FUNCTION "account_numbers_assign_account"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."account_id" IS NULL THEN
    INSERT INTO "financial_accounts" ("id", "user_id", "name", "type", "color", "updated_at")
    VALUES (
      gen_random_uuid()::text, NEW."user_id",
      COALESCE(NULLIF(btrim(NEW."label"), ''), NEW."account_number"),
      CASE WHEN NEW."label" ~* 'credit' OR NEW."account_number" LIKE '%*%' THEN 'credit_card' ELSE 'other' END,
      CASE WHEN NEW."color" ~ '^#[0-9a-fA-F]{6}$' THEN NEW."color" ELSE '#6366f1' END,
      CURRENT_TIMESTAMP
    )
    RETURNING "id" INTO NEW."account_id";
  ELSIF NOT EXISTS (SELECT 1 FROM "financial_accounts" WHERE "id" = NEW."account_id" AND "user_id" = NEW."user_id") THEN
    RAISE EXCEPTION 'account % does not belong to this user', NEW."account_id";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "account_numbers_assign_account"
BEFORE INSERT OR UPDATE OF "account_id" ON "account_numbers"
FOR EACH ROW EXECUTE FUNCTION "account_numbers_assign_account"();

-- Transactions follow their identifier: a new identifier picks up the
-- transactions that already carry it, and moving an identifier to another
-- account moves its transactions too.
CREATE FUNCTION "account_numbers_repoint_transactions"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "transactions" SET "account_id" = NEW."account_id"
    WHERE "user_id" = NEW."user_id" AND "account_number" = NEW."account_number" AND "account_id" IS NULL;
  ELSE
    IF NEW."account_id" IS DISTINCT FROM OLD."account_id" THEN
      UPDATE "transactions" SET "account_id" = NEW."account_id"
      WHERE "user_id" = NEW."user_id" AND "account_number" = NEW."account_number"
        AND "account_id" IS NOT DISTINCT FROM OLD."account_id";
    END IF;
    IF NEW."account_number" IS DISTINCT FROM OLD."account_number" THEN
      UPDATE "transactions" SET "account_id" = NEW."account_id"
      WHERE "user_id" = NEW."user_id" AND "account_number" = NEW."account_number" AND "account_id" IS NULL;
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "account_numbers_repoint_transactions"
AFTER INSERT OR UPDATE OF "account_id", "account_number" ON "account_numbers"
FOR EACH ROW EXECUTE FUNCTION "account_numbers_repoint_transactions"();

-- Keeps transactions.account_id, card_id and account_number consistent:
--   * a newly set card decides the account;
--   * a changed identifier (with no account change) decides the account,
--     none when the identifier isn't mapped;
--   * a changed account keeps the identifier if it maps to that account, else
--     takes the account's oldest identifier;
--   * a card that isn't on the transaction's account is dropped.
CREATE FUNCTION "transactions_sync_account"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  account_changed BOOLEAN;
  number_changed BOOLEAN;
  found TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    account_changed := NEW."account_id" IS NOT NULL;
    number_changed := NEW."account_number" IS NOT NULL;
  ELSE
    account_changed := NEW."account_id" IS DISTINCT FROM OLD."account_id";
    number_changed := NEW."account_number" IS DISTINCT FROM OLD."account_number";
  END IF;

  IF NEW."card_id" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."card_id" IS DISTINCT FROM OLD."card_id") THEN
    SELECT "account_id" INTO found FROM "cards" WHERE "id" = NEW."card_id" AND "user_id" = NEW."user_id";
    IF found IS NOT NULL THEN
      account_changed := account_changed OR NEW."account_id" IS DISTINCT FROM found;
      NEW."account_id" := found;
    END IF;
  END IF;

  IF number_changed AND NOT account_changed THEN
    NEW."account_id" := NULL;
    IF NEW."account_number" IS NOT NULL THEN
      SELECT "account_id" INTO NEW."account_id" FROM "account_numbers"
      WHERE "user_id" = NEW."user_id" AND "account_number" = NEW."account_number";
    END IF;
  ELSIF account_changed AND NEW."account_id" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "financial_accounts" WHERE "id" = NEW."account_id" AND "user_id" = NEW."user_id") THEN
      RAISE EXCEPTION 'account % does not belong to this user', NEW."account_id";
    END IF;
    found := NULL;
    IF NEW."account_number" IS NOT NULL THEN
      SELECT "account_id" INTO found FROM "account_numbers"
      WHERE "user_id" = NEW."user_id" AND "account_number" = NEW."account_number";
    END IF;
    IF NEW."account_number" IS NULL OR found IS DISTINCT FROM NEW."account_id" THEN
      NEW."account_number" := COALESCE(
        (SELECT "account_number" FROM "account_numbers" WHERE "account_id" = NEW."account_id" ORDER BY "created_at", "id" LIMIT 1),
        CASE WHEN found IS NULL THEN NEW."account_number" END
      );
    END IF;
  ELSIF account_changed AND TG_OP = 'UPDATE' THEN
    NEW."account_number" := NULL;
  END IF;

  IF NEW."card_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "cards" WHERE "id" = NEW."card_id" AND "user_id" = NEW."user_id"
      AND "account_id" IS NOT DISTINCT FROM NEW."account_id"
  ) THEN
    NEW."card_id" := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "transactions_sync_account"
BEFORE INSERT OR UPDATE OF "account_id", "account_number", "card_id" ON "transactions"
FOR EACH ROW EXECUTE FUNCTION "transactions_sync_account"();
