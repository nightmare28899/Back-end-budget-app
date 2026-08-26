CREATE TABLE "account_deletion_requests" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT,
  CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "account_deletion_requests_email_createdAt_idx" ON "account_deletion_requests"("email", "created_at");
CREATE INDEX "account_deletion_requests_status_createdAt_idx" ON "account_deletion_requests"("status", "created_at");
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
