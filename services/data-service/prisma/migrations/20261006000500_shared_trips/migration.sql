-- Shared trips: a group links each member's own trip; shares become IOUs in the
-- other member's trip.
CREATE TABLE "trip_groups" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trip_groups_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "trip_groups" ADD CONSTRAINT "trip_groups_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "trip_members" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trip_id" TEXT,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "invited_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trip_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "trip_members_trip_id_key" ON "trip_members"("trip_id");
CREATE UNIQUE INDEX "trip_members_group_id_user_id_key" ON "trip_members"("group_id", "user_id");
CREATE INDEX "trip_members_user_id_status_idx" ON "trip_members"("user_id", "status");
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "trip_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trips" ADD COLUMN "group_id" TEXT;
CREATE INDEX "trips_group_id_idx" ON "trips"("group_id");
ALTER TABLE "trips" ADD CONSTRAINT "trips_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "trip_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trip_entries" ADD COLUMN "shared_from_entry_id" TEXT, ADD COLUMN "created_by" TEXT;
CREATE INDEX "trip_entries_shared_from_entry_id_idx" ON "trip_entries"("shared_from_entry_id");

-- Viewers of a shared trip can't change anything in it, whatever the code path.
CREATE FUNCTION trip_viewer_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM trip_members
    WHERE trip_id = COALESCE(NEW.trip_id, OLD.trip_id) AND role = 'viewer' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'You can only view this shared trip.' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER trip_entries_viewer_guard BEFORE INSERT OR UPDATE OR DELETE ON trip_entries
  FOR EACH ROW EXECUTE FUNCTION trip_viewer_guard();
CREATE TRIGGER trip_fundings_viewer_guard BEFORE INSERT OR UPDATE OR DELETE ON trip_fundings
  FOR EACH ROW EXECUTE FUNCTION trip_viewer_guard();
CREATE TRIGGER wallets_viewer_guard BEFORE INSERT OR UPDATE OR DELETE ON wallets
  FOR EACH ROW EXECUTE FUNCTION trip_viewer_guard();
