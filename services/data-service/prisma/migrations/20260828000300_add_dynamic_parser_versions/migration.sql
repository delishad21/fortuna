CREATE TABLE "dynamic_parser_definitions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "parser_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "file_type" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'bank',
    "active_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dynamic_parser_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dynamic_parser_versions" (
    "id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "parser_type" TEXT NOT NULL,
    "specification" JSONB NOT NULL,
    "source_code" TEXT,
    "source_sha256" TEXT NOT NULL,
    "test_report" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "candidate_id" TEXT,
    "approved_by_user_id" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dynamic_parser_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dynamic_parser_definitions_active_version_id_key" ON "dynamic_parser_definitions"("active_version_id");
CREATE UNIQUE INDEX "dynamic_parser_definitions_user_id_parser_id_key" ON "dynamic_parser_definitions"("user_id", "parser_id");
CREATE INDEX "dynamic_parser_definitions_user_id_mode_idx" ON "dynamic_parser_definitions"("user_id", "mode");
CREATE UNIQUE INDEX "dynamic_parser_versions_candidate_id_key" ON "dynamic_parser_versions"("candidate_id");
CREATE UNIQUE INDEX "dynamic_parser_versions_definition_id_version_key" ON "dynamic_parser_versions"("definition_id", "version");
CREATE INDEX "dynamic_parser_versions_definition_id_status_idx" ON "dynamic_parser_versions"("definition_id", "status");

ALTER TABLE "dynamic_parser_definitions" ADD CONSTRAINT "dynamic_parser_definitions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dynamic_parser_versions" ADD CONSTRAINT "dynamic_parser_versions_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "dynamic_parser_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dynamic_parser_definitions" ADD CONSTRAINT "dynamic_parser_definitions_active_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "dynamic_parser_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
