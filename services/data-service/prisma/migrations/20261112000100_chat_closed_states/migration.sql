-- Reviews can now be cancelled with their run, and older ones relabelled closed below.
ALTER TABLE "chat_transaction_reviews" DROP CONSTRAINT "chat_transaction_reviews_status_check";
ALTER TABLE "chat_transaction_reviews" ADD CONSTRAINT "chat_transaction_reviews_status_check"
    CHECK ("status" IN ('pending','submitted','superseded','cancelled','closed'));
-- Sending a message used to mark pending proposals "rejected" and pending reviews
-- "superseded". Neither was the user's choice, so relabel those as plain "closed".
-- A proposal the user really rejected has the rejection reply saved within seconds.
UPDATE "chat_action_proposals" p
SET "status" = 'closed'
WHERE p."status" = 'rejected'
  AND NOT EXISTS (
    SELECT 1 FROM "chat_messages" m
    WHERE m."conversation_id" = p."conversation_id"
      AND m."role" = 'assistant'
      AND m."blocks"::text LIKE '%The user rejected the proposed changes%'
      AND m."created_at" BETWEEN p."decided_at" - INTERVAL '5 seconds'
                             AND p."decided_at" + INTERVAL '5 seconds'
  );
-- Until now nothing replaced a review with a newer one, so every "superseded" review
-- was closed by a new message or a deleted conversation.
UPDATE "chat_transaction_reviews" SET "status" = 'closed' WHERE "status" = 'superseded';
