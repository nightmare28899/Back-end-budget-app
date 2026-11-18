CREATE TYPE "EntitlementStore" AS ENUM ('APPLE', 'GOOGLE', 'ADMIN');
CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE', 'GRACE_PERIOD', 'BILLING_RETRY', 'CANCELED', 'EXPIRED', 'REFUNDED');
ALTER TABLE "users"
  ADD COLUMN "entitlement_tier" TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN "entitlement_expires_at" TIMESTAMP(3),
  ADD COLUMN "entitlement_store" "EntitlementStore",
  ADD COLUMN "original_transaction_id" TEXT,
  ADD COLUMN "entitlement_status" "EntitlementStatus" NOT NULL DEFAULT 'EXPIRED';
