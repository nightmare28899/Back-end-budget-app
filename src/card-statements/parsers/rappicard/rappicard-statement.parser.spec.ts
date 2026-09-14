import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  StatementFinancingType,
  StatementPaymentTargetKind,
  StatementReconciliationStatus,
  StatementRowDecision,
  StatementRowKind,
  StatementSection,
} from "@prisma/client";
import type { ExtractedStatementText } from "../statement-parser.interface";
import { RappiCardStatementParser } from "./rappicard-statement.parser";

function asExtractedStatement(text: string): ExtractedStatementText {
  const pageTexts = text.split("=== PAGE 2 ===");
  return {
    text,
    pages: pageTexts.map((pageText, index) => ({
      number: index + 1,
      text: pageText.trim(),
    })),
  };
}

describe("RappiCardStatementParser", () => {
  const parser = new RappiCardStatementParser();
  const fixture = readFileSync(
    join(__dirname, "__fixtures__", "rappicard-statement.sanitized.txt"),
    "utf8",
  );
  const extractedFixture = asExtractedStatement(fixture);
  const desgloseFixture = readFileSync(
    join(__dirname, "__fixtures__", "rappicard-statement-desglose.sanitized.txt"),
    "utf8",
  );
  const extractedDesgloseFixture = asExtractedStatement(desgloseFixture);

  it("admits RappiCard statements and rejects Banamex and unknown issuers", () => {
    expect(parser.canParse(extractedFixture)).toBe(true);
    expect(
      parser.canParse({
        text: "BANAMEX RappiCard ESTADO DE CUENTA",
        pages: [],
      }),
    ).toBe(false);
    expect(
      parser.canParse({ text: "OTHER BANK ESTADO DE CUENTA", pages: [] }),
    ).toBe(false);
  });

  it("extracts the DD-MMM-YYYY period and due date", () => {
    const result = parser.parse(extractedFixture);

    expect(result.periodStart.toISOString()).toBe("2026-07-12T12:00:00.000Z");
    expect(result.periodEnd.toISOString()).toBe("2026-08-11T12:00:00.000Z");
    expect(
      result.paymentTargets.every(
        (target) =>
          target.dueDate?.toISOString() === "2026-09-01T12:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("ignores repeated page headers and parses two-date transaction rows", () => {
    const result = parser.parse(extractedFixture);

    expect(result.rows).toHaveLength(5);
    expect(result.rows[0]).toMatchObject({
      transactionDate: new Date("2026-07-13T12:00:00.000Z"),
      description: "CAFETERIA LUNA",
      amount: 250,
    });
    expect(
      result.rows.some((row) => row.description.includes("FECHA DE")),
    ).toBe(false);
  });

  it("preserves charge signs semantically and keeps payments and credits information-only", () => {
    const result = parser.parse(extractedFixture);
    const charge = result.rows.find(
      (row) => row.description === "CAFETERIA LUNA",
    );
    const payment = result.rows.find(
      (row) => row.description === "PAGO RECIBIDO",
    );
    const credit = result.rows.find(
      (row) => row.description === "BONIFICACION PROMOCIONAL",
    );

    expect(charge).toMatchObject({
      kind: StatementRowKind.CHARGE,
      decision: StatementRowDecision.PENDING,
      amount: 250,
    });
    expect(payment).toMatchObject({
      kind: StatementRowKind.PAYMENT,
      decision: StatementRowDecision.INFO_ONLY,
      amount: 200,
    });
    expect(credit).toMatchObject({
      kind: StatementRowKind.CREDIT,
      decision: StatementRowDecision.INFO_ONLY,
      amount: 100,
    });
  });

  it("represents N DE M installment rows through financing-plan contracts", () => {
    const result = parser.parse(extractedFixture);
    const installmentRow = result.rows.find(
      (row) => row.description === "EQUIPO HOGAR 02 DE 06",
    );

    expect(installmentRow).toMatchObject({
      section: StatementSection.FINANCING_PLAN,
      financingPlanPosition: 0,
    });
    expect(result.financingPlans).toEqual([
      expect.objectContaining({
        type: StatementFinancingType.NO_INTEREST,
        merchantName: "EQUIPO HOGAR",
        installmentNumber: 2,
        installmentCount: 6,
        installmentAmount: 650,
      }),
    ]);
  });

  it("keeps repeated-looking rows as distinct page and line occurrences", () => {
    const result = parser.parse(extractedFixture);
    const repeated = result.rows.filter(
      (row) => row.description === "CAFETERIA LUNA",
    );

    expect(repeated).toHaveLength(2);
    expect(repeated[0].occurrenceKey).not.toBe(repeated[1].occurrenceKey);
    expect(repeated.map((row) => row.occurrenceKey)).toEqual([
      expect.stringMatching(/^page-1:line-\d+$/),
      expect.stringMatching(/^page-2:line-\d+$/),
    ]);
  });

  it("extracts structurally proven payment targets and reconciles complete summary labels", () => {
    const result = parser.parse(extractedFixture);

    expect(result.paymentTargets.map((target) => target.kind)).toEqual([
      StatementPaymentTargetKind.MINIMUM,
      StatementPaymentTargetKind.NO_INTEREST,
    ]);
    expect(result.reconciliation).toMatchObject({
      openingBalance: 500,
      chargesTotal: 1150,
      paymentsTotal: 200,
      creditsTotal: 100,
      closingBalance: 1350,
      difference: 0,
      status: StatementReconciliationStatus.PASSED,
    });
  });

  it("parses the real-world layout: 'DESGLOSE DE MOVIMIENTOS' header, YYYY-MM-DD transaction dates, no-MXN-suffix amounts, and footnote-digit payment-target labels", () => {
    const result = parser.parse(extractedDesgloseFixture);

    expect(result.periodStart.toISOString()).toBe("2026-07-16T12:00:00.000Z");
    expect(result.periodEnd.toISOString()).toBe("2026-08-15T12:00:00.000Z");

    expect(
      result.rows.filter((row) => row.section === StatementSection.CURRENT_CHARGES),
    ).toHaveLength(2);

    const noInterestRow = result.rows.find(
      (row) => row.description === "TIENDA HOGAR 02 DE 06",
    );
    const interestBearingRow = result.rows.find(
      (row) => row.description === "TIENDA ELECTRONICA 03 DE 12",
    );
    expect(noInterestRow?.section).toBe(StatementSection.FINANCING_PLAN);
    expect(interestBearingRow?.section).toBe(StatementSection.FINANCING_PLAN);
    expect(result.financingPlans).toEqual([
      expect.objectContaining({
        type: StatementFinancingType.NO_INTEREST,
        installmentNumber: 2,
        installmentCount: 6,
        installmentAmount: 500,
      }),
      expect.objectContaining({
        type: StatementFinancingType.INTEREST_BEARING,
        installmentNumber: 3,
        installmentCount: 12,
        installmentAmount: 750,
      }),
    ]);

    expect(result.reconciliation).toMatchObject({
      status: StatementReconciliationStatus.PASSED,
      openingBalance: 5000,
      chargesTotal: 2500,
      paymentsTotal: 1000,
      closingBalance: 6500,
    });

    expect(result.paymentTargets.map((target) => target.kind)).toEqual(
      expect.arrayContaining([
        StatementPaymentTargetKind.NO_INTEREST,
        StatementPaymentTargetKind.MINIMUM,
      ]),
    );
  });

  it("returns reviewable rows with failed reconciliation when summary alignment is unsafe", () => {
    const text = [
      "RappiCard",
      "ESTADO DE CUENTA",
      "PERIODO: 12-JUL-2026 AL 11-AGO-2026",
      "MOVIMIENTOS DEL PERIODO",
      "13-JUL-2026 14-JUL-2026 LIBRERIA SOL +$75.00 MXN",
    ].join("\n");

    const result = parser.parse(asExtractedStatement(text));

    expect(result.rows).toHaveLength(1);
    expect(result.reconciliation.status).toBe(
      StatementReconciliationStatus.FAILED,
    );
    expect(result.reconciliation.message).toMatch(
      /could not be safely aligned/i,
    );
    expect(result.warningCount).toBeGreaterThan(0);
  });
});
