-- People on a trip, and IOUs: spending someone else paid for, settled later.
CREATE TABLE "trip_participants" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trip_participants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "trip_participants_trip_id_name_key" ON "trip_participants"("trip_id", "name");
CREATE UNIQUE INDEX "trip_participants_trip_id_user_id_key" ON "trip_participants"("trip_id", "user_id");
ALTER TABLE "trip_participants" ADD CONSTRAINT "trip_participants_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_participants" ADD CONSTRAINT "trip_participants_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trip_entries" ADD COLUMN "counterparty_id" TEXT;
CREATE INDEX "trip_entries_counterparty_id_idx" ON "trip_entries"("counterparty_id");
ALTER TABLE "trip_entries" ADD CONSTRAINT "trip_entries_counterparty_id_fkey"
    FOREIGN KEY ("counterparty_id") REFERENCES "trip_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "trip_settlement_allocations" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "settlement_entry_id" TEXT NOT NULL,
    "iou_entry_id" TEXT NOT NULL,
    "iou_local_amount" DECIMAL(14,4) NOT NULL,
    "weight_base" DECIMAL(14,4) NOT NULL,
    "amount_base" DECIMAL(14,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trip_settlement_allocations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "trip_settlement_allocations_settlement_entry_id_iou_entry_id_key"
    ON "trip_settlement_allocations"("settlement_entry_id", "iou_entry_id");
CREATE INDEX "trip_settlement_allocations_trip_id_idx" ON "trip_settlement_allocations"("trip_id");
CREATE INDEX "trip_settlement_allocations_iou_entry_id_idx" ON "trip_settlement_allocations"("iou_entry_id");
ALTER TABLE "trip_settlement_allocations" ADD CONSTRAINT "trip_settlement_allocations_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_settlement_allocations" ADD CONSTRAINT "trip_settlement_allocations_settlement_entry_id_fkey"
    FOREIGN KEY ("settlement_entry_id") REFERENCES "trip_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_settlement_allocations" ADD CONSTRAINT "trip_settlement_allocations_iou_entry_id_fkey"
    FOREIGN KEY ("iou_entry_id") REFERENCES "trip_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
