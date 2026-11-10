-- Read-only mailbox connection per user (Gmail over IMAP), used by the chat to
-- read PayLah alert emails. The secret is an AES-GCM sealed app password.
CREATE TABLE "mail_connections" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gmail',
    "address" TEXT NOT NULL,
    "secret" JSONB NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mail_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mail_connections_user_id_key" ON "mail_connections"("user_id");
ALTER TABLE "mail_connections" ADD CONSTRAINT "mail_connections_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
