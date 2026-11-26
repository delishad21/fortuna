-- Reimbursable spending: money out the user paid for someone who pays it back
-- (e.g. a partner). It is a flag beside the category, not a category: the row
-- keeps its real category, and names the person and the amount they owe.
-- Repayments are linked through reimbursement_links as before; what a person
-- still owes is their items' amounts minus the repayments linked to them.

CREATE TABLE "reimbursement_people" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reimbursement_people_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reimbursement_people_user_id_name_key" ON "reimbursement_people"("user_id", "name");
ALTER TABLE "reimbursement_people" ADD CONSTRAINT "reimbursement_people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "transactions"
  ADD COLUMN "reimbursable_person_id" TEXT,
  ADD COLUMN "reimbursable_amount" DECIMAL(12,2),
  ADD COLUMN "reimbursable_share" DECIMAL(7,6),
  ADD COLUMN "reimbursable_note" TEXT,
  ADD CONSTRAINT "transactions_reimbursable_amount_check" CHECK ("reimbursable_amount" IS NULL OR "reimbursable_amount" >= 0),
  ADD CONSTRAINT "transactions_reimbursable_share_check" CHECK ("reimbursable_share" IS NULL OR ("reimbursable_share" > 0 AND "reimbursable_share" <= 1));
CREATE INDEX "transactions_user_id_reimbursable_person_id_idx" ON "transactions"("user_id", "reimbursable_person_id");
-- A person with items can't be deleted (archive them instead).
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reimbursable_person_id_fkey" FOREIGN KEY ("reimbursable_person_id") REFERENCES "reimbursement_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keeps the flag consistent with the row, whoever writes it: only money out
-- that is not an internal transfer or a reimbursement can be owed; a share
-- (a fraction, 1 = in full) follows amount_out when it changes, and a fixed
-- amount never exceeds it. The person must be the row owner's.
CREATE FUNCTION "transactions_keep_reimbursable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."reimbursable_person_id" IS NOT NULL AND (
    COALESCE(NEW."amount_out", 0) <= 0
    OR COALESCE(NEW."linkage"->>'type', '') IN ('internal', 'reimbursement')
  ) THEN
    NEW."reimbursable_person_id" := NULL;
  END IF;
  IF NEW."reimbursable_person_id" IS NULL THEN
    NEW."reimbursable_amount" := NULL;
    NEW."reimbursable_share" := NULL;
    NEW."reimbursable_note" := NULL;
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' OR NEW."reimbursable_person_id" IS DISTINCT FROM OLD."reimbursable_person_id")
    AND NOT EXISTS (
      SELECT 1 FROM "reimbursement_people"
      WHERE "id" = NEW."reimbursable_person_id" AND "user_id" = NEW."user_id"
    ) THEN
    RAISE EXCEPTION 'reimbursement person % does not belong to this user', NEW."reimbursable_person_id";
  END IF;
  IF NEW."reimbursable_share" IS NOT NULL THEN
    NEW."reimbursable_amount" := round(NEW."amount_out" * NEW."reimbursable_share", 2);
  ELSIF NEW."reimbursable_amount" IS NULL THEN
    NEW."reimbursable_share" := 1;
    NEW."reimbursable_amount" := NEW."amount_out";
  ELSIF NEW."reimbursable_amount" > NEW."amount_out" THEN
    NEW."reimbursable_amount" := NEW."amount_out";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "transactions_keep_reimbursable"
BEFORE INSERT OR UPDATE ON "transactions"
FOR EACH ROW EXECUTE FUNCTION "transactions_keep_reimbursable"();

-- Analytics show reimbursable spending apart from the user's own by default;
-- true counts it as their own spending until it is repaid.
ALTER TABLE "user_settings" ADD COLUMN "analytics_count_reimbursable" BOOLEAN NOT NULL DEFAULT false;
