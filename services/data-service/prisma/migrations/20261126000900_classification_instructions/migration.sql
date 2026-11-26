-- Classification instructions: the user's judgement about how to classify, in
-- their words, shared by Fortuna's chat agent and the outside assistant
-- (Hermes and twee through finance-mcp). They replace the chat-only notes in
-- chat_memories. An instruction can be scoped to an account, a card, an entry
-- source or a merchant pattern; a one-off instruction stops being served
-- after its end date.

CREATE TABLE "classification_instructions" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "scope_type" TEXT,
    "account_id" TEXT,
    "card_id" TEXT,
    "entry_source" TEXT,
    "merchant_pattern" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'lasting',
    "ends_on" DATE,
    "author" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classification_instructions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classification_instructions_kind_check" CHECK (
        ("kind" = 'lasting' AND "ends_on" IS NULL) OR ("kind" = 'one_off' AND "ends_on" IS NOT NULL)
    ),
    CONSTRAINT "classification_instructions_author_check" CHECK ("author" IN ('user', 'fortuna_chat', 'assistant')),
    -- Exactly the field its scope needs, and no other.
    CONSTRAINT "classification_instructions_scope_check" CHECK (
        ("scope_type" IS NULL AND "account_id" IS NULL AND "card_id" IS NULL AND "entry_source" IS NULL AND "merchant_pattern" IS NULL)
        OR ("scope_type" = 'account' AND "account_id" IS NOT NULL AND "card_id" IS NULL AND "entry_source" IS NULL AND "merchant_pattern" IS NULL)
        OR ("scope_type" = 'card' AND "card_id" IS NOT NULL AND "account_id" IS NULL AND "entry_source" IS NULL AND "merchant_pattern" IS NULL)
        OR ("scope_type" = 'entry_source' AND "entry_source" IN ('assistant', 'manual', 'statement', 'mobile') AND "account_id" IS NULL AND "card_id" IS NULL AND "merchant_pattern" IS NULL)
        OR ("scope_type" = 'merchant' AND length(btrim("merchant_pattern")) > 0 AND "account_id" IS NULL AND "card_id" IS NULL AND "entry_source" IS NULL)
    )
);
CREATE INDEX "classification_instructions_user_id_enabled_idx" ON "classification_instructions"("user_id", "enabled");
CREATE INDEX "classification_instructions_account_id_idx" ON "classification_instructions"("account_id");
CREATE INDEX "classification_instructions_card_id_idx" ON "classification_instructions"("card_id");
ALTER TABLE "classification_instructions" ADD CONSTRAINT "classification_instructions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_instructions" ADD CONSTRAINT "classification_instructions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_instructions" ADD CONSTRAINT "classification_instructions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every saved chat note moves over with its id and timestamps; the chat saved them.
-- A note about a one-off monthly calculation (e.g. "For the November 2026
-- Madeline spending calculation, ...") was a fact about that task: it becomes
-- one-off and has already ended on the day it was written. (Outstanding
-- balances per person replace it.)
INSERT INTO "classification_instructions" ("id", "user_id", "text", "kind", "ends_on", "author", "created_at", "updated_at")
SELECT
    "id",
    "user_id",
    "content",
    CASE WHEN "content" ~* '^\s*for the \w+ \d{4} .*calculation' THEN 'one_off' ELSE 'lasting' END,
    CASE WHEN "content" ~* '^\s*for the \w+ \d{4} .*calculation' THEN ("created_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Singapore')::date ELSE NULL END,
    'fortuna_chat',
    "created_at",
    "updated_at"
FROM "chat_memories";

-- A lasting note about SimplyGo journeys is scoped to the user's SimplyGo
-- account, when they have exactly one; otherwise to SimplyGo descriptions.
WITH simplygo AS (
    SELECT "user_id", min("id") AS "account_id", count(*) AS "accounts"
    FROM "financial_accounts"
    WHERE "name" ILIKE '%simplygo%' AND NOT "archived"
    GROUP BY "user_id"
)
UPDATE "classification_instructions" AS i
SET "scope_type" = CASE WHEN s."accounts" = 1 THEN 'account' ELSE 'merchant' END,
    "account_id" = CASE WHEN s."accounts" = 1 THEN s."account_id" ELSE NULL END,
    "merchant_pattern" = CASE WHEN s."accounts" = 1 THEN NULL ELSE 'SimplyGo' END
FROM "classification_instructions" AS c
LEFT JOIN simplygo AS s ON s."user_id" = c."user_id"
WHERE i."id" = c."id"
  AND c."kind" = 'lasting'
  AND c."text" ILIKE '%simplygo%';

DROP TABLE "chat_memories";
