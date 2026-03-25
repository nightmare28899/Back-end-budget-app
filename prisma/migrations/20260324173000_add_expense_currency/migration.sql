ALTER TABLE "expenses"
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'MXN';

UPDATE "expenses" AS e
SET "currency" = COALESCE(u."currency", 'MXN')
FROM "users" AS u
WHERE e."userId" = u."id";
