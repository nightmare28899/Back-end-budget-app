DO $$
BEGIN
  CREATE TYPE "StatementPaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "StatementPaymentSource" AS ENUM ('MANUAL', 'LEGACY_BACKFILL', 'CORRECTION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "statement_imports"
  ADD COLUMN IF NOT EXISTS "paymentStatus" "StatementPaymentStatus" NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS "paymentVersion" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statement_imports_payment_version_nonnegative_check'
      AND conrelid = 'statement_imports'::regclass
  ) THEN
    ALTER TABLE "statement_imports"
      ADD CONSTRAINT "statement_imports_payment_version_nonnegative_check"
      CHECK ("paymentVersion" >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "statement_payments" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "statementImportId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "source" "StatementPaymentSource" NOT NULL DEFAULT 'MANUAL',
  "idempotencyKey" TEXT,
  "supersedesId" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "statement_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "statement_payments_amount_positive_check" CHECK ("amount" > 0),
  CONSTRAINT "statement_payments_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "statement_payments_note_length_check" CHECK ("note" IS NULL OR char_length(btrim("note")) BETWEEN 1 AND 500),
  CONSTRAINT "statement_payments_idempotency_length_check" CHECK ("idempotencyKey" IS NULL OR char_length("idempotencyKey") BETWEEN 1 AND 100),
  CONSTRAINT "statement_payments_void_reason_check" CHECK (
    ("voidedAt" IS NULL AND "voidReason" IS NULL)
    OR ("voidedAt" IS NOT NULL AND char_length(btrim("voidReason")) BETWEEN 1 AND 500)
  ),
  CONSTRAINT "statement_payments_not_self_superseding_check" CHECK ("supersedesId" IS NULL OR "supersedesId" <> "id"),
  CONSTRAINT "statement_payments_user_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "statement_payments_statement_import_fkey" FOREIGN KEY ("statementImportId") REFERENCES "statement_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "statement_payments_supersedes_fkey" FOREIGN KEY ("supersedesId") REFERENCES "statement_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "statement_payments_user_idempotency_key"
  ON "statement_payments"("userId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "statement_payments_active_statement_idx"
  ON "statement_payments"("statementImportId", "voidedAt", "paidAt");
CREATE INDEX IF NOT EXISTS "statement_payments_user_created_idx"
  ON "statement_payments"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "statement_payments_supersedes_idx"
  ON "statement_payments"("supersedesId");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "statement_imports"
    WHERE "paidAmount" < 0
  ) THEN
    RAISE EXCEPTION 'statement payment backfill aborted: negative paidAmount is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "statement_imports"
    WHERE "paidAmount" > 0 AND "paidAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'statement payment backfill aborted: positive paidAmount requires paidAt';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "statement_imports"
    WHERE "isPaid" AND COALESCE("paidAmount", 0) = 0
  ) THEN
    RAISE EXCEPTION 'statement payment backfill aborted: paid statement without a positive paidAmount';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "statement_imports" si
    LEFT JOIN "statement_reconciliations" sr ON sr."statementImportId" = si."id"
    LEFT JOIN "credit_cards" cc ON cc."id" = si."creditCardId"
    WHERE si."paidAmount" > 0
      AND (
        sr."id" IS NULL
        OR sr."currency" !~ '^[A-Z]{3}$'
        OR (cc."id" IS NOT NULL AND cc."currency" <> sr."currency")
      )
  ) THEN
    RAISE EXCEPTION 'statement payment backfill aborted: incoherent currency basis';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "statement_imports" si
    JOIN "statement_reconciliations" sr ON sr."statementImportId" = si."id"
    JOIN "statement_payment_targets" spt
      ON spt."statementImportId" = si."id"
      AND spt."kind" = 'NO_INTEREST'
      AND spt."currency" = sr."currency"
    GROUP BY si."id"
    HAVING COUNT(DISTINCT spt."amount") > 1
  ) THEN
    RAISE EXCEPTION 'statement payment backfill aborted: conflicting equal-priority NO_INTEREST targets';
  END IF;
END $$;

INSERT INTO "statement_payments" (
  "userId",
  "statementImportId",
  "amount",
  "currency",
  "paidAt",
  "source",
  "idempotencyKey",
  "createdAt",
  "updatedAt"
)
SELECT
  si."userId",
  si."id",
  si."paidAmount",
  sr."currency",
  si."paidAt",
  'LEGACY_BACKFILL'::"StatementPaymentSource",
  'legacy-backfill:' || si."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "statement_imports" si
JOIN "statement_reconciliations" sr ON sr."statementImportId" = si."id"
WHERE si."paidAmount" > 0
ON CONFLICT ("userId", "idempotencyKey") DO NOTHING;

WITH target_basis AS (
  SELECT
    si."id" AS "statementImportId",
    MIN(spt."amount") AS "targetAmount"
  FROM "statement_imports" si
  JOIN "statement_reconciliations" sr ON sr."statementImportId" = si."id"
  JOIN "statement_payment_targets" spt
    ON spt."statementImportId" = si."id"
    AND spt."kind" = 'NO_INTEREST'
    AND spt."currency" = sr."currency"
  GROUP BY si."id"
  HAVING COUNT(DISTINCT spt."amount") = 1
), payment_totals AS (
  SELECT
    si."id" AS "statementImportId",
    COALESCE(SUM(sp."amount") FILTER (
      WHERE sp."voidedAt" IS NULL AND sp."currency" = sr."currency"
    ), 0)::DECIMAL(12,2) AS "paidTotal",
    MAX(sp."paidAt") FILTER (
      WHERE sp."voidedAt" IS NULL AND sp."currency" = sr."currency"
    ) AS "lastPaidAt",
    COALESCE(tb."targetAmount", sr."closingBalance") AS "statusBasis"
  FROM "statement_imports" si
  LEFT JOIN "statement_reconciliations" sr ON sr."statementImportId" = si."id"
  LEFT JOIN target_basis tb ON tb."statementImportId" = si."id"
  LEFT JOIN "statement_payments" sp ON sp."statementImportId" = si."id"
  GROUP BY si."id", sr."currency", sr."closingBalance", tb."targetAmount"
)
UPDATE "statement_imports" si
SET
  "paidAmount" = CASE WHEN pt."paidTotal" > 0 THEN pt."paidTotal" ELSE NULL END,
  "paidAt" = CASE
    WHEN pt."paidTotal" > 0 THEN pt."lastPaidAt"
    WHEN si."isPaid" THEN si."paidAt"
    ELSE NULL
  END,
  "paymentStatus" = CASE
    WHEN pt."paidTotal" = 0 THEN 'UNPAID'::"StatementPaymentStatus"
    WHEN pt."statusBasis" IS NOT NULL AND pt."paidTotal" >= pt."statusBasis" THEN 'PAID'::"StatementPaymentStatus"
    ELSE 'PARTIAL'::"StatementPaymentStatus"
  END,
  "isPaid" = (
    pt."paidTotal" > 0
    AND pt."statusBasis" IS NOT NULL
    AND pt."paidTotal" >= pt."statusBasis"
  )
FROM payment_totals pt
WHERE pt."statementImportId" = si."id";

-- Match Prisma's client-side generation (@default(uuid()) / @updatedAt): the
-- backfill above needed these defaults, the schema does not declare them.
ALTER TABLE "statement_payments"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "updatedAt" DROP DEFAULT;
