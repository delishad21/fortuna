-- Notes the user asked the chat assistant to remember across conversations.
CREATE TABLE "chat_memories" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chat_memories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "chat_memories_user_id_updated_at_idx" ON "chat_memories"("user_id", "updated_at");
