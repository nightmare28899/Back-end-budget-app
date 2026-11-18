ALTER TABLE "credit_cards"
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'MXN';

ALTER TABLE "statement_reconciliations"
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'MXN';

ALTER TABLE "statement_rows"
  ADD COLUMN "parsedTransactionDate" TIMESTAMP(3),
  ADD COLUMN "parsedAmount" DECIMAL(12,2),
  ADD COLUMN "parsedCurrency" TEXT,
  ADD COLUMN "parsedKind" "StatementRowKind";

UPDATE "credit_cards"
SET "currency" = 'MXN'
WHERE "currency" IS NULL;

UPDATE "statement_reconciliations"
SET "currency" = 'MXN'
WHERE "currency" IS NULL;

UPDATE "statement_rows"
SET
  "parsedTransactionDate" = "transactionDate",
  "parsedAmount" = "amount",
  "parsedCurrency" = "currency",
  "parsedKind" = "kind";

ALTER TABLE "statement_rows"
  ALTER COLUMN "parsedAmount" SET NOT NULL,
  ALTER COLUMN "parsedCurrency" SET NOT NULL,
  ALTER COLUMN "parsedKind" SET NOT NULL;

ALTER TABLE "credit_cards"
  ADD CONSTRAINT "credit_cards_currency_format_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "statement_reconciliations"
  ADD CONSTRAINT "statement_reconciliations_currency_format_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "statement_rows"
  ADD CONSTRAINT "statement_rows_parsed_currency_format_check"
  CHECK ("parsedCurrency" ~ '^[A-Z]{3}$');

ALTER TABLE "statement_imports"
  ADD CONSTRAINT "statement_imports_user_card_period_key"
  UNIQUE ("userId", "creditCardId", "periodStart", "periodEnd");
