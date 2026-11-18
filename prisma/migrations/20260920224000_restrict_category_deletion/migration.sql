ALTER TABLE "expenses"
  DROP CONSTRAINT "expenses_categoryId_fkey";

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscriptions"
  DROP CONSTRAINT "subscriptions_categoryId_fkey";

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "statement_rows"
  DROP CONSTRAINT "statement_rows_categoryId_fkey";

ALTER TABLE "statement_rows"
  ADD CONSTRAINT "statement_rows_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
