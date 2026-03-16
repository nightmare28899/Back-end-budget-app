-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SavingsTransactionType') THEN
    CREATE TYPE "SavingsTransactionType" AS ENUM ('DEPOSIT');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "savings_goals" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "targetAmount" DECIMAL(10,2) NOT NULL,
  "currentAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "savings_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "savings_transactions" (
  "id" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "type" "SavingsTransactionType" NOT NULL DEFAULT 'DEPOSIT',
  "goalId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "savings_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "savings_goals_userId_createdAt_idx" ON "savings_goals"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "savings_transactions_goalId_createdAt_idx" ON "savings_transactions"("goalId", "createdAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'savings_goals_userId_fkey'
  ) THEN
    ALTER TABLE "savings_goals"
      ADD CONSTRAINT "savings_goals_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'savings_transactions_goalId_fkey'
  ) THEN
    ALTER TABLE "savings_transactions"
      ADD CONSTRAINT "savings_transactions_goalId_fkey"
      FOREIGN KEY ("goalId") REFERENCES "savings_goals"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
