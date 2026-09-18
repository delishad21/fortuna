CREATE TABLE "statement_files" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "retained" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "statement_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "import_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "parser_id" TEXT,
    "source_filename" TEXT NOT NULL,
    "source_file_id" TEXT,
    "source_sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "version" INTEGER NOT NULL DEFAULT 1,
    "target_trip_id" TEXT,
    "parser_version" TEXT,
    "validation_hash" TEXT,
    "commit_token_hash" TEXT,
    "commit_token_expires_at" TIMESTAMP(3),
    "commit_token_used_at" TIMESTAMP(3),
    "committed_import_batch_id" TEXT,
    "error" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "committed_at" TIMESTAMP(3),
    "discarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "import_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "import_draft_rows" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "parsed_payload" JSONB NOT NULL,
    "current_payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "review_status" TEXT NOT NULL DEFAULT 'unresolved',
    "provenance" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "import_draft_rows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "classification_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "claimed_by" TEXT,
    "capabilities" JSONB,
    "input_version" INTEGER NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "classification_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "classification_proposals" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "job_id" TEXT,
    "draft_row_id" TEXT NOT NULL,
    "input_draft_version" INTEGER NOT NULL,
    "input_row_version" INTEGER NOT NULL,
    "proposed_label" TEXT,
    "proposed_category_id" TEXT,
    "proposed_linkage" JSONB,
    "proposed_trip_id" TEXT,
    "proposed_trip_entry_type" TEXT,
    "proposed_wallet_id" TEXT,
    "confidence" DECIMAL(5,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "model" TEXT NOT NULL,
    "effort" TEXT,
    "prompt_version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "idempotency_key" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    CONSTRAINT "classification_proposals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_audit_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "request_id" TEXT,
    "tool_name" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "model" TEXT,
    "effort" TEXT,
    "prompt_version" TEXT,
    "before_value" JSONB,
    "after_value" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "parser_workspaces" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "statement_file_ids" JSONB NOT NULL,
    "fixture_consent_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "parser_workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "parser_candidates" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "parser_id" TEXT NOT NULL,
    "parser_type" TEXT NOT NULL,
    "specification" JSONB NOT NULL,
    "source_code" TEXT,
    "test_report" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "approved_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "parser_candidates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "statement_files_user_id_sha256_key" ON "statement_files"("user_id", "sha256");
CREATE INDEX "statement_files_user_id_expires_at_idx" ON "statement_files"("user_id", "expires_at");
CREATE INDEX "import_drafts_user_id_status_updated_at_idx" ON "import_drafts"("user_id", "status", "updated_at");
CREATE INDEX "import_drafts_source_file_id_idx" ON "import_drafts"("source_file_id");
CREATE UNIQUE INDEX "import_draft_rows_draft_id_row_index_key" ON "import_draft_rows"("draft_id", "row_index");
CREATE INDEX "import_draft_rows_draft_id_review_status_idx" ON "import_draft_rows"("draft_id", "review_status");
CREATE INDEX "classification_jobs_user_id_status_created_at_idx" ON "classification_jobs"("user_id", "status", "created_at");
CREATE INDEX "classification_jobs_draft_id_idx" ON "classification_jobs"("draft_id");
CREATE UNIQUE INDEX "classification_proposals_idempotency_key_key" ON "classification_proposals"("idempotency_key");
CREATE INDEX "classification_proposals_draft_id_status_idx" ON "classification_proposals"("draft_id", "status");
CREATE INDEX "classification_proposals_draft_row_id_idx" ON "classification_proposals"("draft_row_id");
CREATE INDEX "agent_audit_events_user_id_created_at_idx" ON "agent_audit_events"("user_id", "created_at");
CREATE INDEX "agent_audit_events_target_type_target_id_idx" ON "agent_audit_events"("target_type", "target_id");
CREATE INDEX "parser_workspaces_user_id_status_idx" ON "parser_workspaces"("user_id", "status");
CREATE UNIQUE INDEX "parser_candidates_workspace_id_parser_id_key" ON "parser_candidates"("workspace_id", "parser_id");
CREATE INDEX "parser_candidates_status_idx" ON "parser_candidates"("status");

ALTER TABLE "statement_files" ADD CONSTRAINT "statement_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_drafts" ADD CONSTRAINT "import_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_drafts" ADD CONSTRAINT "import_drafts_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "statement_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "import_draft_rows" ADD CONSTRAINT "import_draft_rows_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "import_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_jobs" ADD CONSTRAINT "classification_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_jobs" ADD CONSTRAINT "classification_jobs_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "import_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_proposals" ADD CONSTRAINT "classification_proposals_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "import_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_proposals" ADD CONSTRAINT "classification_proposals_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "classification_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "classification_proposals" ADD CONSTRAINT "classification_proposals_draft_row_id_fkey" FOREIGN KEY ("draft_row_id") REFERENCES "import_draft_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_audit_events" ADD CONSTRAINT "agent_audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "parser_workspaces" ADD CONSTRAINT "parser_workspaces_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "parser_candidates" ADD CONSTRAINT "parser_candidates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "parser_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
