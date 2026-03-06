-- Add flexible budget configuration fields
ALTER TABLE "users"
  ADD COLUMN "budgetAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "budgetPeriod" TEXT NOT NULL DEFAULT 'daily',
  ADD COLUMN "budgetPeriodStart" TIMESTAMP(3),
  ADD COLUMN "budgetPeriodEnd" TIMESTAMP(3);

-- Backfill new amount from the legacy daily budget field
UPDATE "users"
SET "budgetAmount" = "dailyBudget";
