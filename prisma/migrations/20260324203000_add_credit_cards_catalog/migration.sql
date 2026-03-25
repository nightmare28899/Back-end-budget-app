-- AlterEnum
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";

CREATE TYPE "PaymentMethod" AS ENUM (
  'CASH',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'TRANSFER'
);

ALTER TABLE "expenses"
ALTER COLUMN "paymentMethod" DROP DEFAULT;

ALTER TABLE "subscriptions"
ALTER COLUMN "paymentMethod" DROP DEFAULT;

ALTER TABLE "expenses"
ALTER COLUMN "paymentMethod"
TYPE "PaymentMethod"
USING (
  CASE
    WHEN "paymentMethod"::text = 'CARD' THEN 'CREDIT_CARD'
    ELSE "paymentMethod"::text
  END
)::"PaymentMethod";

ALTER TABLE "subscriptions"
ALTER COLUMN "paymentMethod"
TYPE "PaymentMethod"
USING (
  CASE
    WHEN "paymentMethod"::text = 'CARD' THEN 'CREDIT_CARD'
    ELSE "paymentMethod"::text
  END
)::"PaymentMethod";

ALTER TABLE "expenses"
ALTER COLUMN "paymentMethod" SET DEFAULT 'CASH';

ALTER TABLE "subscriptions"
ALTER COLUMN "paymentMethod" SET DEFAULT 'CREDIT_CARD';

DROP TYPE "PaymentMethod_old";

-- CreateTable
CREATE TABLE "credit_cards" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "bank" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "last4" TEXT NOT NULL,
  "color" TEXT,
  "creditLimit" DECIMAL(10,2),
  "closingDay" INTEGER,
  "paymentDueDay" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "credit_cards_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "expenses"
ADD COLUMN "creditCardId" TEXT;

-- AlterTable
ALTER TABLE "subscriptions"
ADD COLUMN "creditCardId" TEXT;

-- CreateIndex
CREATE INDEX "credit_cards_userId_isActive_name_idx"
ON "credit_cards"("userId", "isActive", "name");

-- CreateIndex
CREATE INDEX "expenses_creditCardId_idx"
ON "expenses"("creditCardId");

-- CreateIndex
CREATE INDEX "subscriptions_creditCardId_idx"
ON "subscriptions"("creditCardId");

-- AddForeignKey
ALTER TABLE "credit_cards"
ADD CONSTRAINT "credit_cards_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses"
ADD CONSTRAINT "expenses_creditCardId_fkey"
FOREIGN KEY ("creditCardId") REFERENCES "credit_cards"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions"
ADD CONSTRAINT "subscriptions_creditCardId_fkey"
FOREIGN KEY ("creditCardId") REFERENCES "credit_cards"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
