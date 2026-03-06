-- AlterEnum
ALTER TYPE "BillingCycle" ADD VALUE 'DAILY';

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "isSubscription" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subscriptionId" TEXT;

-- CreateIndex
CREATE INDEX "expenses_userId_isSubscription_date_idx" ON "expenses"("userId", "isSubscription", "date");

-- CreateIndex
CREATE INDEX "expenses_subscriptionId_idx" ON "expenses"("subscriptionId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
