-- Rates for currencies like IDR or VND need more than 6 decimal places.
ALTER TABLE "trip_fundings" ALTER COLUMN "fx_rate" TYPE DECIMAL(20,10);
ALTER TABLE "trip_entries" ALTER COLUMN "fx_rate" TYPE DECIMAL(20,10);
ALTER TABLE "trip_reimbursement_allocations" ALTER COLUMN "reimbursing_fx_rate" TYPE DECIMAL(20,10);
ALTER TABLE "trip_reimbursement_allocations" ALTER COLUMN "reimbursed_fx_rate" TYPE DECIMAL(20,10);
