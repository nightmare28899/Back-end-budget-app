ALTER TABLE "expenses"
ADD COLUMN "merchant_name" TEXT,
ADD COLUMN "location_label" TEXT;

CREATE INDEX "expenses_userId_location_label_date_idx"
  ON "expenses"("userId", "location_label", "date");

CREATE INDEX "expenses_userId_merchant_name_date_idx"
  ON "expenses"("userId", "merchant_name", "date");
