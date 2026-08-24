-- Repair category IDs created by 20260816120000_add_category_to_subscriptions.
-- The old MD5-derived values are UUID-shaped but fail RFC UUID validation.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "expenses"
  DROP CONSTRAINT IF EXISTS "expenses_categoryId_fkey";

ALTER TABLE "subscriptions"
  DROP CONSTRAINT IF EXISTS "subscriptions_categoryId_fkey";

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "categories" AS categories
SET "id" = gen_random_uuid()::text
WHERE categories."id" = md5('subscription-category:' || categories."userId")::uuid::text
  AND categories."name" = 'Suscripción'
  AND NOT EXISTS (
    SELECT 1
    FROM "categories" AS replacement
    WHERE replacement."userId" = categories."userId"
      AND lower(replacement."name") = lower(categories."name")
      AND replacement."id" <> categories."id"
  );
