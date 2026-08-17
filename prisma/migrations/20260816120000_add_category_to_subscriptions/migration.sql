ALTER TABLE "subscriptions"
ADD COLUMN "categoryId" TEXT;

CREATE INDEX "subscriptions_userId_categoryId_idx"
ON "subscriptions"("userId", "categoryId");

ALTER TABLE "subscriptions"
ADD CONSTRAINT "subscriptions_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "categories" ("id", "name", "icon", "color", "userId")
SELECT
  md5('subscription-category:' || users."id")::uuid::text,
  'Suscripción',
  '🔁',
  '#8B5CF6',
  users."id"
FROM "users" users
WHERE NOT EXISTS (
  SELECT 1
  FROM "categories" categories
  WHERE categories."userId" = users."id"
    AND LOWER(categories."name") = LOWER('Suscripción')
);

UPDATE "subscriptions" subscriptions
SET "categoryId" = categories."id"
FROM "categories" categories
WHERE subscriptions."userId" = categories."userId"
  AND LOWER(categories."name") = LOWER('Suscripción')
  AND subscriptions."categoryId" IS NULL;

UPDATE "expenses" expenses
SET "categoryId" = subscriptions."categoryId"
FROM "subscriptions" subscriptions
WHERE expenses."subscriptionId" = subscriptions."id"
  AND expenses."isSubscription" = true
  AND expenses."categoryId" IS NULL
  AND subscriptions."categoryId" IS NOT NULL;
