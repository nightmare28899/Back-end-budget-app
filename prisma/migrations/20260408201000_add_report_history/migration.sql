CREATE TABLE "report_history" (
    "id" TEXT NOT NULL,
    "period_type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "reference_date" TIMESTAMP(3) NOT NULL,
    "report_start" TIMESTAMP(3) NOT NULL,
    "report_end" TIMESTAMP(3) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "userId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_history_userId_created_at_idx" ON "report_history"("userId", "created_at");
CREATE INDEX "report_history_userId_period_type_reference_date_idx" ON "report_history"("userId", "period_type", "reference_date");

ALTER TABLE "report_history"
ADD CONSTRAINT "report_history_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
