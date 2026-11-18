CREATE TYPE "DetectedPurchaseStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISCARDED');
CREATE TYPE "DetectedPurchaseConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TABLE "detected_purchases" (
 "id" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "fingerprint" VARCHAR(256) NOT NULL,
 "sourcePackage" VARCHAR(255) NOT NULL,
 "amountCents" BIGINT NOT NULL,
 "currency" VARCHAR(3) NOT NULL,
 "merchant" VARCHAR(120),
 "occurredAtMillis" BIGINT NOT NULL,
 "confidence" "DetectedPurchaseConfidence" NOT NULL,
 "possibleDuplicateOf" VARCHAR(256),
 "mayBeRegistered" BOOLEAN NOT NULL DEFAULT false,
 "status" "DetectedPurchaseStatus" NOT NULL DEFAULT 'PENDING',
 "expenseId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "detected_purchases_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "detected_purchases_amount_check" CHECK ("amountCents" BETWEEN 1 AND 9999999999),
 CONSTRAINT "detected_purchases_date_check" CHECK ("occurredAtMillis" BETWEEN 0 AND 8640000000000000),
 CONSTRAINT "detected_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "detected_purchases_userId_fingerprint_key" ON "detected_purchases"("userId", "fingerprint");
CREATE INDEX "detected_purchases_userId_status_occurredAtMillis_idx" ON "detected_purchases"("userId", "status", "occurredAtMillis");
