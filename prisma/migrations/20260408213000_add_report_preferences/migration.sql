ALTER TABLE "users"
ADD COLUMN "weekly_report_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "monthly_report_enabled" BOOLEAN NOT NULL DEFAULT false;
