CREATE TYPE "InstallmentFrequency" AS ENUM ('MONTHLY');

ALTER TABLE "expenses"
ADD COLUMN "isInstallment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "installmentGroupId" TEXT,
ADD COLUMN "installmentCount" INTEGER,
ADD COLUMN "installmentIndex" INTEGER,
ADD COLUMN "installmentTotalAmount" DECIMAL(10,2),
ADD COLUMN "installmentFrequency" "InstallmentFrequency",
ADD COLUMN "installmentPurchaseDate" TIMESTAMP(3),
ADD COLUMN "installmentFirstPaymentDate" TIMESTAMP(3);

CREATE INDEX "expenses_userId_isInstallment_date_idx" ON "expenses"("userId", "isInstallment", "date");
CREATE INDEX "expenses_installmentGroupId_idx" ON "expenses"("installmentGroupId");
