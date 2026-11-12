-- Messages sent while a conversation is replying wait here, in order, and start by
-- themselves when the reply before them finishes.
CREATE TABLE "chat_queued_messages" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'message' CHECK ("kind" IN ('message','continuation')),
    "text" TEXT NOT NULL DEFAULT '',
    "attachment_ids" JSONB NOT NULL DEFAULT '[]',
    "review_id" TEXT,
    "review_title" TEXT,
    "review_rows" JSONB,
    "status" TEXT NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued','failed')),
    "error" TEXT,
    "queued_at" TIMESTAMP(6) NOT NULL DEFAULT clock_timestamp(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chat_queued_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chat_queued_messages_user_id_conversation_id_idempotency_key_key" ON "chat_queued_messages"("user_id", "conversation_id", "idempotency_key");
CREATE INDEX "chat_queued_messages_conversation_id_status_queued_at_idx" ON "chat_queued_messages"("conversation_id", "status", "queued_at");
CREATE INDEX "chat_queued_messages_user_id_status_idx" ON "chat_queued_messages"("user_id", "status");
ALTER TABLE "chat_queued_messages" ADD CONSTRAINT "chat_queued_messages_conversation_id_user_id_fkey" FOREIGN KEY ("conversation_id", "user_id") REFERENCES "chat_conversations"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A review sent back while the conversation is replying waits in the queue, locked.
ALTER TABLE "chat_transaction_reviews" DROP CONSTRAINT "chat_transaction_reviews_status_check";
ALTER TABLE "chat_transaction_reviews" ADD CONSTRAINT "chat_transaction_reviews_status_check"
    CHECK ("status" IN ('pending','queued','submitted','superseded','cancelled','closed'));
