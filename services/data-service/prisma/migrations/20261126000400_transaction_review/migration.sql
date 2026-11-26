-- Review queue for assistant entries. Fortuna classifies what the assistant
-- writes and queues it for review; every other row (statement imports, manual
-- and phone entries, and every row that exists today) is already reviewed,
-- which the column default gives them.
ALTER TABLE "transactions" ADD COLUMN "review_status" TEXT NOT NULL DEFAULT 'reviewed',
ADD COLUMN "review_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "reviewed_at" TIMESTAMP(3);

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_review_status_check"
  CHECK ("review_status" IN ('to_review', 'reviewed'));

CREATE INDEX "transactions_user_id_review_status_idx" ON "transactions"("user_id", "review_status");

-- Accounts Fortuna creates when an assistant entry matches none.
ALTER TABLE "account_numbers" ADD COLUMN "auto_created" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "auto_created_from" TEXT;
