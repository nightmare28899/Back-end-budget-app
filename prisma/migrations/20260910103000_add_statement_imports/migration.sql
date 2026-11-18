CREATE TYPE "StatementImportStatus" AS ENUM (
  'UPLOADED',
  'PARSED',
  'NEEDS_REVIEW',
  'CONFIRMED',
  'REVERTED',
  'FAILED'
);

CREATE TYPE "StatementSourceFormat" AS ENUM ('PDF');

CREATE TYPE "StatementSection" AS ENUM (
  'RECONCILIATION',
  'PAYMENT_TARGET',
  'CURRENT_CHARGES',
  'FINANCING_PLAN',
  'CFDI',
  'OTHER'
);

CREATE TYPE "StatementRowKind" AS ENUM (
  'CHARGE',
  'PAYMENT',
  'CREDIT',
  'INTEREST',
  'TAX',
  'REFINANCED_PRINCIPAL',
  'CFDI',
  'UNKNOWN'
);

CREATE TYPE "StatementRowDecision" AS ENUM (
  'PENDING',
  'INCLUDE_EXPENSE',
  'EXCLUDE',
  'INFO_ONLY'
);

CREATE TYPE "StatementReconciliationStatus" AS ENUM (
  'PENDING',
  'PASSED',
  'FAILED'
);

CREATE TYPE "StatementInstrumentKind" AS ENUM (
  'PHYSICAL',
  'DIGITAL',
  'UNKNOWN'
);

CREATE TYPE "StatementFinancingType" AS ENUM (
  'NO_INTEREST',
  'INTEREST_BEARING',
  'REFINANCED'
);

CREATE TYPE "StatementPaymentTargetKind" AS ENUM (
  'MINIMUM',
  'MINIMUM_PLUS_INSTALLMENTS',
  'NO_INTEREST',
  'OTHER'
);

CREATE TABLE "statement_imports" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "creditCardId" TEXT,
  "sourceFormat" "StatementSourceFormat" NOT NULL DEFAULT 'PDF',
  "sourceFileName" TEXT,
  "sourceMimeType" TEXT NOT NULL,
  "sourceSizeBytes" INTEGER NOT NULL,
  "sourceSha256" TEXT NOT NULL,
  "sourceObjectKey" TEXT,
  "status" "StatementImportStatus" NOT NULL DEFAULT 'UPLOADED',
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "parserVersion" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "parsedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "revertedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "statement_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "statement_reconciliations" (
  "id" TEXT NOT NULL,
  "statementImportId" TEXT NOT NULL,
  "openingBalance" DECIMAL(12,2) NOT NULL,
  "chargesTotal" DECIMAL(12,2) NOT NULL,
  "paymentsTotal" DECIMAL(12,2) NOT NULL,
  "creditsTotal" DECIMAL(12,2) NOT NULL,
  "closingBalance" DECIMAL(12,2) NOT NULL,
  "difference" DECIMAL(12,2) NOT NULL,
  "status" "StatementReconciliationStatus" NOT NULL DEFAULT 'PENDING',
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "statement_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "statement_payment_targets" (
  "id" TEXT NOT NULL,
  "statementImportId" TEXT NOT NULL,
  "kind" "StatementPaymentTargetKind" NOT NULL,
  "label" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'MXN',
  "dueDate" TIMESTAMP(3),
  "sourceRowNumber" INTEGER,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "statement_payment_targets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "statement_instrument_snapshots" (
  "id" TEXT NOT NULL,
  "statementImportId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "kind" "StatementInstrumentKind" NOT NULL DEFAULT 'UNKNOWN',
  "last4" TEXT,
  "linkedCreditCardId" TEXT,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "statement_instrument_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "statement_financing_plans" (
  "id" TEXT NOT NULL,
  "statementImportId" TEXT NOT NULL,
  "instrumentSnapshotId" TEXT,
  "type" "StatementFinancingType" NOT NULL,
  "merchantName" TEXT,
  "purchaseDate" TIMESTAMP(3),
  "originalAmount" DECIMAL(12,2),
  "installmentAmount" DECIMAL(12,2),
  "installmentNumber" INTEGER,
  "installmentCount" INTEGER,
  "remainingAmount" DECIMAL(12,2),
  "currency" TEXT NOT NULL DEFAULT 'MXN',
  "sourceRowNumber" INTEGER,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "statement_financing_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "statement_rows" (
  "id" TEXT NOT NULL,
  "statementImportId" TEXT NOT NULL,
  "occurrenceKey" TEXT NOT NULL,
  "section" "StatementSection" NOT NULL,
  "sourceRowNumber" INTEGER,
  "position" INTEGER NOT NULL,
  "transactionDate" TIMESTAMP(3),
  "description" TEXT NOT NULL,
  "merchantName" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'MXN',
  "kind" "StatementRowKind" NOT NULL,
  "decision" "StatementRowDecision" NOT NULL DEFAULT 'PENDING',
  "categoryId" TEXT,
  "linkedCreditCardId" TEXT,
  "financingPlanId" TEXT,
  "warningCodes" JSONB,
  "rawText" TEXT,
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "statement_rows_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "expenses" ADD COLUMN "statementRowId" TEXT;

CREATE UNIQUE INDEX "statement_imports_userId_sourceSha256_key"
ON "statement_imports"("userId", "sourceSha256");
CREATE INDEX "statement_imports_userId_status_createdAt_idx"
ON "statement_imports"("userId", "status", "createdAt");
CREATE INDEX "statement_imports_creditCardId_idx"
ON "statement_imports"("creditCardId");
CREATE UNIQUE INDEX "statement_reconciliations_statementImportId_key"
ON "statement_reconciliations"("statementImportId");
CREATE UNIQUE INDEX "statement_targets_import_position_key"
ON "statement_payment_targets"("statementImportId", "position");
CREATE INDEX "statement_payment_targets_statementImportId_kind_idx"
ON "statement_payment_targets"("statementImportId", "kind");
CREATE UNIQUE INDEX "statement_instruments_import_position_key"
ON "statement_instrument_snapshots"("statementImportId", "position");
CREATE INDEX "statement_instrument_snapshots_linkedCreditCardId_idx"
ON "statement_instrument_snapshots"("linkedCreditCardId");
CREATE UNIQUE INDEX "statement_plans_import_position_key"
ON "statement_financing_plans"("statementImportId", "position");
CREATE INDEX "statement_financing_plans_instrumentSnapshotId_idx"
ON "statement_financing_plans"("instrumentSnapshotId");
CREATE UNIQUE INDEX "statement_rows_statementImportId_occurrenceKey_key"
ON "statement_rows"("statementImportId", "occurrenceKey");
CREATE INDEX "statement_rows_statementImportId_decision_position_idx"
ON "statement_rows"("statementImportId", "decision", "position");
CREATE INDEX "statement_rows_categoryId_idx" ON "statement_rows"("categoryId");
CREATE INDEX "statement_rows_linkedCreditCardId_idx" ON "statement_rows"("linkedCreditCardId");
CREATE INDEX "statement_rows_financingPlanId_idx" ON "statement_rows"("financingPlanId");
CREATE UNIQUE INDEX "expenses_statementRowId_key" ON "expenses"("statementRowId");

ALTER TABLE "statement_imports"
ADD CONSTRAINT "statement_imports_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "statement_imports"
ADD CONSTRAINT "statement_imports_creditCardId_fkey"
FOREIGN KEY ("creditCardId") REFERENCES "credit_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "statement_reconciliations"
ADD CONSTRAINT "statement_reconciliations_statementImportId_fkey"
FOREIGN KEY ("statementImportId") REFERENCES "statement_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "statement_payment_targets"
ADD CONSTRAINT "statement_payment_targets_statementImportId_fkey"
FOREIGN KEY ("statementImportId") REFERENCES "statement_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "statement_instrument_snapshots"
ADD CONSTRAINT "statement_instrument_snapshots_statementImportId_fkey"
FOREIGN KEY ("statementImportId") REFERENCES "statement_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "statement_instrument_snapshots"
ADD CONSTRAINT "statement_instrument_snapshots_linkedCreditCardId_fkey"
FOREIGN KEY ("linkedCreditCardId") REFERENCES "credit_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "statement_financing_plans"
ADD CONSTRAINT "statement_financing_plans_statementImportId_fkey"
FOREIGN KEY ("statementImportId") REFERENCES "statement_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "statement_financing_plans"
ADD CONSTRAINT "statement_financing_plans_instrumentSnapshotId_fkey"
FOREIGN KEY ("instrumentSnapshotId") REFERENCES "statement_instrument_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "statement_rows"
ADD CONSTRAINT "statement_rows_statementImportId_fkey"
FOREIGN KEY ("statementImportId") REFERENCES "statement_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "statement_rows"
ADD CONSTRAINT "statement_rows_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "statement_rows"
ADD CONSTRAINT "statement_rows_linkedCreditCardId_fkey"
FOREIGN KEY ("linkedCreditCardId") REFERENCES "credit_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "statement_rows"
ADD CONSTRAINT "statement_rows_financingPlanId_fkey"
FOREIGN KEY ("financingPlanId") REFERENCES "statement_financing_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expenses"
ADD CONSTRAINT "expenses_statementRowId_fkey"
FOREIGN KEY ("statementRowId") REFERENCES "statement_rows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
