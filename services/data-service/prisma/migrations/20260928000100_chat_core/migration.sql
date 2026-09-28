-- CreateTable
CREATE TABLE "chat_connections" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "secret" JSONB,
    "key_hint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "login_id" TEXT,
    "login_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_attachments" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "statement_file_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_runs" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "effort" TEXT,
    "connection_generation" INTEGER NOT NULL DEFAULT 1,
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_sequence" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_run_events" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_tool_invocations" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_tool_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_action_proposals" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "state_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_action_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_connections_user_id_provider_key" ON "chat_connections"("user_id", "provider");

-- CreateIndex
CREATE INDEX "chat_conversations_user_id_updated_at_idx" ON "chat_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversations_id_user_id_key" ON "chat_conversations"("id", "user_id");

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_attachments_conversation_id_statement_file_id_key" ON "chat_attachments"("conversation_id", "statement_file_id");

-- CreateIndex
CREATE INDEX "chat_runs_status_lease_until_created_at_idx" ON "chat_runs"("status", "lease_until", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_runs_id_user_id_conversation_id_key" ON "chat_runs"("id", "user_id", "conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_runs_user_id_conversation_id_idempotency_key_key" ON "chat_runs"("user_id", "conversation_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "chat_run_events_run_id_sequence_key" ON "chat_run_events"("run_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "chat_tool_invocations_run_id_call_id_key" ON "chat_tool_invocations"("run_id", "call_id");

-- CreateIndex
CREATE INDEX "chat_action_proposals_user_id_status_idx" ON "chat_action_proposals"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "statement_files_id_user_id_key" ON "statement_files"("id", "user_id");

-- AddForeignKey
ALTER TABLE "chat_connections" ADD CONSTRAINT "chat_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_user_id_fkey" FOREIGN KEY ("conversation_id", "user_id") REFERENCES "chat_conversations"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_conversation_id_user_id_fkey" FOREIGN KEY ("conversation_id", "user_id") REFERENCES "chat_conversations"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_statement_file_id_user_id_fkey" FOREIGN KEY ("statement_file_id", "user_id") REFERENCES "statement_files"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_runs" ADD CONSTRAINT "chat_runs_conversation_id_user_id_fkey" FOREIGN KEY ("conversation_id", "user_id") REFERENCES "chat_conversations"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_run_events" ADD CONSTRAINT "chat_run_events_run_id_user_id_conversation_id_fkey" FOREIGN KEY ("run_id", "user_id", "conversation_id") REFERENCES "chat_runs"("id", "user_id", "conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_tool_invocations" ADD CONSTRAINT "chat_tool_invocations_run_id_user_id_conversation_id_fkey" FOREIGN KEY ("run_id", "user_id", "conversation_id") REFERENCES "chat_runs"("id", "user_id", "conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_action_proposals" ADD CONSTRAINT "chat_action_proposals_run_id_user_id_conversation_id_fkey" FOREIGN KEY ("run_id", "user_id", "conversation_id") REFERENCES "chat_runs"("id", "user_id", "conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE UNIQUE INDEX chat_runs_one_active_conversation ON chat_runs(conversation_id) WHERE status IN ('queued','running','awaiting_confirmation');
CREATE UNIQUE INDEX chat_connections_one_selected ON chat_connections(user_id) WHERE selected = true;
ALTER TABLE chat_connections ADD CONSTRAINT chat_provider_valid CHECK (provider IN ('codex','openrouter'));
ALTER TABLE chat_runs ADD CONSTRAINT chat_run_status_valid CHECK (status IN ('queued','running','awaiting_confirmation','completed','failed','cancelled'));
