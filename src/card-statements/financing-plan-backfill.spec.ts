import { StatementFinancingType } from "@prisma/client";
import {
  FinancingPlanBackfillError,
  buildFinancingPlanBackfill,
  selectBackfillParser,
  sha256Hex,
  summarizeBackfillPlans,
} from "./financing-plan-backfill";
import type { ParsedStatementData } from "./card-statements.types";
import type {
  ExtractedStatementText,
  StatementParser,
} from "./parsers/statement-parser.interface";

describe("buildFinancingPlanBackfill", () => {
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
      parserVersion: "synthetic-text-v1",
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
    const data = buildFinancingPlanBackfill({
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
      buildFinancingPlanBackfill({
        statementImport,
        pdfSha256: sha256Hex(Buffer.from("other")),
        parsed: parsed(),
        instrumentSnapshots: snapshots,
      }),
    ).toThrow(FinancingPlanBackfillError);
  });

  it("rejects a parsed period that differs from the import period", () => {
    expect(() =>
      buildFinancingPlanBackfill({
        statementImport,
        pdfSha256: sha256Hex(pdf),
        parsed: parsed({ periodEnd: new Date("2026-10-21T12:00:00.000Z") }),
        instrumentSnapshots: snapshots,
      }),
    ).toThrow(/period/i);
  });

  it("rejects a parse that yields no plans instead of wiping the old ones", () => {
    expect(() =>
      buildFinancingPlanBackfill({
        statementImport,
        pdfSha256: sha256Hex(pdf),
        parsed: parsed({ financingPlans: [] }),
        instrumentSnapshots: snapshots,
      }),
    ).toThrow(/no financing plans/i);
  });

  it("summarizes counts and amounts only", () => {
    const data = buildFinancingPlanBackfill({
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

describe("selectBackfillParser", () => {
  const extracted: ExtractedStatementText = { text: "synthetic", pages: [] };
  const parserThat = (accepts: boolean): StatementParser => ({
    canParse: () => accepts,
    parse: () => {
      throw new Error("not used");
    },
  });

  it("uses the parser of the requested issuer when it accepts the PDF", () => {
    const banamex = parserThat(true);
    const rappicard = parserThat(true);

    expect(
      selectBackfillParser("rappicard", { banamex, rappicard }, extracted),
    ).toBe(rappicard);
  });

  it("rejects a PDF the requested issuer's parser does not accept", () => {
    expect(() =>
      selectBackfillParser(
        "rappicard",
        { banamex: parserThat(true), rappicard: parserThat(false) },
        extracted,
      ),
    ).toThrow(/not a rappicard statement/i);
  });

  it("auto-detects the issuer when exactly one parser accepts the PDF", () => {
    const rappicard = parserThat(true);

    expect(
      selectBackfillParser(
        undefined,
        { banamex: parserThat(false), rappicard },
        extracted,
      ),
    ).toBe(rappicard);
  });

  it.each([
    ["none", false, false],
    ["several", true, true],
  ])("refuses to auto-detect when %s parsers accept the PDF", (_, a, b) => {
    expect(() =>
      selectBackfillParser(
        undefined,
        { banamex: parserThat(a), rappicard: parserThat(b) },
        extracted,
      ),
    ).toThrow(/--issuer/);
  });

  it("rejects an unknown issuer", () => {
    expect(() =>
      selectBackfillParser(
        "unknown",
        { banamex: parserThat(true), rappicard: parserThat(true) },
        extracted,
      ),
    ).toThrow(/unknown issuer/i);
  });
});
