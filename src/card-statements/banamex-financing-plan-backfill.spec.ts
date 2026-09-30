import { StatementFinancingType } from "@prisma/client";
import {
  BanamexBackfillError,
  buildBanamexFinancingPlanBackfill,
  sha256Hex,
  summarizeBackfillPlans,
} from "./banamex-financing-plan-backfill";
import type { ParsedStatementData } from "./card-statements.types";

describe("buildBanamexFinancingPlanBackfill", () => {
  const pdf = Buffer.from("synthetic-pdf-bytes");
  const statementImport = {
    id: "import-1",
    sourceSha256: sha256Hex(pdf),
    periodStart: new Date("2026-08-22T12:00:00.000Z"),
    periodEnd: new Date("2026-09-21T00:00:00.000Z"),
  };

  function parsed(
    overrides: Partial<ParsedStatementData> = {},
  ): ParsedStatementData {
    return {
      parserVersion: "banamex-text-v1",
      periodStart: new Date("2026-08-22T12:00:00.000Z"),
      periodEnd: new Date("2026-09-21T12:00:00.000Z"),
      warningCount: 0,
      instruments: [],
      financingPlans: [
        {
          position: 0,
          instrumentPosition: 1,
          type: StatementFinancingType.INTEREST_BEARING,
          merchantName: "PLAN A",
          purchaseDate: new Date("2026-09-21T12:00:00.000Z"),
          originalAmount: 4000,
          remainingAmount: 2865.55,
          installmentAmount: 300.16,
          installmentNumber: 4,
          installmentCount: 12,
          currency: "MXN",
          sourceRowNumber: 20,
        },
        {
          position: 1,
          type: StatementFinancingType.NO_INTEREST,
          originalAmount: 1000,
          remainingAmount: 500,
          installmentAmount: 100,
          installmentNumber: 5,
          installmentCount: 10,
          currency: "MXN",
        },
      ],
      paymentTargets: [],
      rows: [],
      ...overrides,
    } as ParsedStatementData;
  }

  const snapshots = [
    { id: "snap-0", position: 0 },
    { id: "snap-1", position: 1 },
  ];

  it("builds createMany data bound to the import and instrument snapshots", () => {
    const data = buildBanamexFinancingPlanBackfill({
      statementImport,
      pdfSha256: sha256Hex(pdf),
      parsed: parsed(),
      instrumentSnapshots: snapshots,
    });

    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      statementImportId: "import-1",
      instrumentSnapshotId: "snap-1",
      position: 0,
      originalAmount: 4000,
      remainingAmount: 2865.55,
      installmentAmount: 300.16,
      installmentNumber: 4,
      installmentCount: 12,
      currency: "MXN",
    });
    expect(data[1].instrumentSnapshotId).toBeNull();
  });

  it("rejects a PDF whose hash differs from the import", () => {
    expect(() =>
      buildBanamexFinancingPlanBackfill({
        statementImport,
        pdfSha256: sha256Hex(Buffer.from("other")),
        parsed: parsed(),
        instrumentSnapshots: snapshots,
      }),
    ).toThrow(BanamexBackfillError);
  });

  it("rejects a parsed period that differs from the import period", () => {
    expect(() =>
      buildBanamexFinancingPlanBackfill({
        statementImport,
        pdfSha256: sha256Hex(pdf),
        parsed: parsed({ periodEnd: new Date("2026-10-21T12:00:00.000Z") }),
        instrumentSnapshots: snapshots,
      }),
    ).toThrow(/period/i);
  });

  it("rejects a parse that yields no plans instead of wiping the old ones", () => {
    expect(() =>
      buildBanamexFinancingPlanBackfill({
        statementImport,
        pdfSha256: sha256Hex(pdf),
        parsed: parsed({ financingPlans: [] }),
        instrumentSnapshots: snapshots,
      }),
    ).toThrow(/no financing plans/i);
  });

  it("summarizes counts and amounts only", () => {
    const data = buildBanamexFinancingPlanBackfill({
      statementImport,
      pdfSha256: sha256Hex(pdf),
      parsed: parsed(),
      instrumentSnapshots: snapshots,
    });

    expect(summarizeBackfillPlans(data)).toEqual({
      planCount: 2,
      totalRemainingAmount: 3365.55,
      totalInstallmentAmount: 400.16,
      plans: [
        {
          installment: "4/12",
          originalAmount: 4000,
          remainingAmount: 2865.55,
          installmentAmount: 300.16,
        },
        {
          installment: "5/10",
          originalAmount: 1000,
          remainingAmount: 500,
          installmentAmount: 100,
        },
      ],
    });
  });
});
