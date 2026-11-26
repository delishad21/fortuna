-- Sources: how each account's or card's transactions reach the assistant
-- (bank app notifications, alert emails), and the reports that tie every
-- message the assistant sent to the one transaction it describes.
--
-- externalId schemes (enforced by the API): email:<Message-ID> and
-- notif:<package>:<key>:<post time in ms>. A report per externalId means a
-- message re-read by a cron job updates its transaction, and a backup
-- channel's message about a purchase the main channel reported points at the
-- main channel's transaction instead of adding a second one.

CREATE TABLE "transaction_sources" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "card_id" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "senders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject_patterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "text_patterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "identifiers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channel" TEXT NOT NULL DEFAULT 'main',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transaction_sources_kind_check" CHECK ("kind" IN ('notification', 'email')),
    CONSTRAINT "transaction_sources_channel_check" CHECK ("channel" IN ('main', 'backup'))
);
CREATE INDEX "transaction_sources_user_id_kind_enabled_idx" ON "transaction_sources"("user_id", "kind", "enabled");
CREATE INDEX "transaction_sources_account_id_idx" ON "transaction_sources"("account_id");
CREATE INDEX "transaction_sources_card_id_idx" ON "transaction_sources"("card_id");
ALTER TABLE "transaction_sources" ADD CONSTRAINT "transaction_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transaction_sources" ADD CONSTRAINT "transaction_sources_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transaction_sources" ADD CONSTRAINT "transaction_sources_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "transaction_source_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    -- Null once the transaction is deleted: re-reading the message doesn't bring it back.
    "transaction_id" TEXT,
    "source_id" TEXT,
    "external_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT,
    "primary" BOOLEAN NOT NULL DEFAULT true,
    "facts" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_source_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transaction_source_reports_kind_check" CHECK ("kind" IN ('notification', 'email', 'other')),
    CONSTRAINT "transaction_source_reports_channel_check" CHECK ("channel" IS NULL OR "channel" IN ('main', 'backup'))
);
CREATE UNIQUE INDEX "transaction_source_reports_user_id_external_id_key" ON "transaction_source_reports"("user_id", "external_id");
CREATE INDEX "transaction_source_reports_transaction_id_idx" ON "transaction_source_reports"("transaction_id");
CREATE INDEX "transaction_source_reports_source_id_idx" ON "transaction_source_reports"("source_id");
ALTER TABLE "transaction_source_reports" ADD CONSTRAINT "transaction_source_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transaction_source_reports" ADD CONSTRAINT "transaction_source_reports_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transaction_source_reports" ADD CONSTRAINT "transaction_source_reports_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "transaction_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Entries written before this change keep working: each externalId gets its report.
INSERT INTO "transaction_source_reports" ("id", "user_id", "transaction_id", "external_id", "kind", "primary", "updated_at")
SELECT
    'tsr_' || md5("id"),
    "user_id",
    "id",
    "external_id",
    CASE
        WHEN "external_id" LIKE 'email:%' THEN 'email'
        WHEN "external_id" LIKE 'notif:%' THEN 'notification'
        ELSE 'other'
    END,
    true,
    CURRENT_TIMESTAMP
FROM "transactions"
WHERE "external_id" IS NOT NULL;
