-- AlterTable
ALTER TABLE "credit_cards" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill: preserve the current visible order per user (oldest first).
UPDATE "credit_cards" AS c
SET "sortOrder" = ranked."position"
FROM (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId"
      ORDER BY "createdAt", "id"
    ) - 1 AS "position"
  FROM "credit_cards"
) AS ranked
WHERE c."id" = ranked."id";
