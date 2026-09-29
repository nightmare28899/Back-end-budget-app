import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("statement payment ledger migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260929150000_statement_payment_ledger/migration.sql",
    ),
    "utf8",
  );

  it("creates an append-only ledger with named integrity constraints", () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "statement_payments"');
    expect(sql).toContain('"statement_payments_amount_positive_check"');
    expect(sql).toContain('"statement_payments_currency_format_check"');
    expect(sql).toContain("ON DELETE RESTRICT");
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"statement_payments"/i);
  });

  it("guards unsafe legacy states and conflicting no-interest targets", () => {
    expect(sql).toContain("positive paidAmount requires paidAt");
    expect(sql).toContain("negative paidAmount is invalid");
    expect(sql).toContain("incoherent currency basis");
    expect(sql).toContain("paid statement without a positive paidAmount");
    expect(sql).toContain('COUNT(DISTINCT spt."amount") > 1');
  });

  it("uses deterministic idempotent backfill and target-first status", () => {
    expect(sql).toContain("'legacy-backfill:' || si.\"id\"");
    expect(sql).toContain(
      'ON CONFLICT ("userId", "idempotencyKey") DO NOTHING',
    );
    expect(sql).toContain('COALESCE(tb."targetAmount", sr."closingBalance")');
    expect(sql).toContain("WHEN pt.\"paidTotal\" = 0 THEN 'UNPAID'");
    expect(sql).toContain('pt."paidTotal" >= pt."statusBasis"');
    expect(sql).toContain("'PARTIAL'::\"StatementPaymentStatus\"");
  });

  it("drops the backfill-only column defaults to match Prisma", () => {
    expect(sql).toMatch(
      /ALTER COLUMN "id" DROP DEFAULT,\s+ALTER COLUMN "updatedAt" DROP DEFAULT/,
    );
  });

  it("is guarded for repeat execution without deleting ledger history", () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "paymentStatus"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "statement_payments_user_idempotency_key"',
    );
    expect(sql).toContain("WHEN duplicate_object THEN NULL");
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE)/i);
  });
});
