-- Wallets the user keeps across trips (e.g. Revolut), and each trip wallet's owner.
CREATE TABLE "wallet_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "color" TEXT NOT NULL DEFAULT '#60a5fa',
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wallet_accounts_user_id_name_key" ON "wallet_accounts"("user_id", "name");
CREATE INDEX "wallet_accounts_user_id_provider_idx" ON "wallet_accounts"("user_id", "provider");
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wallets" ADD COLUMN "user_id" TEXT, ADD COLUMN "account_id" TEXT;
UPDATE "wallets" w SET "user_id" = t."user_id" FROM "trips" t WHERE t."id" = w."trip_id";
ALTER TABLE "wallets" ALTER COLUMN "user_id" SET NOT NULL;
CREATE INDEX "wallets_account_id_idx" ON "wallets"("account_id");
CREATE INDEX "wallets_user_id_idx" ON "wallets"("user_id");
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "wallet_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Wallets imported as "<Provider> <CCY>" belong to that provider's account.
INSERT INTO "wallet_accounts" ("id", "user_id", "name", "provider", "color", "updated_at")
SELECT DISTINCT ON (w."user_id", prefix)
    md5(random()::text || clock_timestamp()::text),
    w."user_id",
    prefix,
    CASE WHEN lower(prefix) IN ('revolut', 'youtrip') THEN lower(prefix) END,
    w."color",
    CURRENT_TIMESTAMP
FROM (
    SELECT *, substring("name" from '^(.+) [A-Z]{3}$') AS prefix
    FROM "wallets"
    WHERE "name" ~ '^.+ [A-Z]{3}$' AND right("name", 3) = upper("currency")
) w
WHERE prefix IS NOT NULL AND prefix NOT IN ('Trip Transfer', 'Trip')
ON CONFLICT ("user_id", "name") DO NOTHING;

UPDATE "wallets" w
SET "account_id" = a."id"
FROM "wallet_accounts" a
WHERE a."user_id" = w."user_id"
  AND w."name" ~ '^.+ [A-Z]{3}$'
  AND right(w."name", 3) = upper(w."currency")
  AND a."name" = substring(w."name" from '^(.+) [A-Z]{3}$');
