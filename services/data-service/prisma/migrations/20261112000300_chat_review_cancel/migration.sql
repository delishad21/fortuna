-- The user can now cancel a review; when they do, this records when. Reviews closed
-- because their reply was stopped stay without it.
ALTER TABLE "chat_transaction_reviews" ADD COLUMN "decided_at" TIMESTAMP(3);
