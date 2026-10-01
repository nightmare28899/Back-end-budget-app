-- Link a statement row to an already-registered manual expense it duplicates.
ALTER TABLE "statement_rows"
  ADD COLUMN IF NOT EXISTS "matchedExpenseId" TEXT;

CREATE INDEX IF NOT EXISTS "statement_rows_matchedExpenseId_idx"
  ON "statement_rows"("matchedExpenseId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statement_rows_matchedExpenseId_fkey'
      AND conrelid = 'statement_rows'::regclass
  ) THEN
    ALTER TABLE "statement_rows"
      ADD CONSTRAINT "statement_rows_matchedExpenseId_fkey"
      FOREIGN KEY ("matchedExpenseId") REFERENCES "expenses"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
