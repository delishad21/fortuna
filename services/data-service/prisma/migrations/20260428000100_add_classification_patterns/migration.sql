CREATE TABLE "classification_patterns" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pattern_type" TEXT NOT NULL,
    "pattern_value" TEXT NOT NULL,
    "parser_id" TEXT,
    "direction" TEXT,
    "label" TEXT,
    "category_id" TEXT,
    "mark_internal" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DECIMAL(5,3) NOT NULL DEFAULT 0,
    "support_count" INTEGER NOT NULL DEFAULT 0,
    "match_count" INTEGER NOT NULL DEFAULT 0,
    "conflict_count" INTEGER NOT NULL DEFAULT 0,
    "applied_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'suggest',
    "last_seen_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classification_patterns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "classification_patterns_user_id_pattern_type_pattern_value_parser_id_direction_key"
ON "classification_patterns"("user_id", "pattern_type", "pattern_value", "parser_id", "direction");

CREATE INDEX "classification_patterns_user_id_status_idx"
ON "classification_patterns"("user_id", "status");

CREATE INDEX "classification_patterns_user_id_pattern_type_idx"
ON "classification_patterns"("user_id", "pattern_type");

ALTER TABLE "classification_patterns"
ADD CONSTRAINT "classification_patterns_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "classification_patterns"
ADD CONSTRAINT "classification_patterns_category_id_fkey"
FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
