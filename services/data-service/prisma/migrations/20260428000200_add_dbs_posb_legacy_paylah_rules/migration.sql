INSERT INTO "import_rules" (
  "id", "user_id", "name", "parser_id", "match_type", "match_value", "case_sensitive", "enabled", "mark_internal", "sort_order", "created_at", "updated_at"
)
SELECT
  ('rule_' || substr(md5(random()::text || clock_timestamp()::text || u."id"), 1, 24)),
  u."id",
  'DBS/POSB legacy top-up to PayLah is Internal',
  'dbs_posb_consolidated_legacy',
  'description_contains',
  'TOP-UP TO PAYLAH!',
  false,
  true,
  true,
  21,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1
  FROM "import_rules" r
  WHERE r."user_id" = u."id"
    AND r."name" = 'DBS/POSB legacy top-up to PayLah is Internal'
);

INSERT INTO "import_rules" (
  "id", "user_id", "name", "parser_id", "match_type", "match_value", "case_sensitive", "enabled", "mark_internal", "sort_order", "created_at", "updated_at"
)
SELECT
  ('rule_' || substr(md5(random()::text || clock_timestamp()::text || u."id"), 1, 24)),
  u."id",
  'DBS/POSB legacy receive back from PayLah is Internal',
  'dbs_posb_consolidated_legacy',
  'description_contains',
  'SEND BACK FROM PAYLAH!',
  false,
  true,
  true,
  41,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1
  FROM "import_rules" r
  WHERE r."user_id" = u."id"
    AND r."name" = 'DBS/POSB legacy receive back from PayLah is Internal'
);