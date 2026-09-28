CREATE TABLE "chat_transaction_reviews" (
 "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "user_id" TEXT NOT NULL, "conversation_id" TEXT NOT NULL, "run_id" TEXT NOT NULL,
 "title" TEXT NOT NULL, "instructions" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','superseded')),
 "version" INTEGER NOT NULL DEFAULT 1, "rows" JSONB NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY (run_id,user_id,conversation_id) REFERENCES chat_runs(id,user_id,conversation_id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "chat_transaction_reviews_user_id_conversation_id_status_idx" ON "chat_transaction_reviews" (user_id,conversation_id,status);
