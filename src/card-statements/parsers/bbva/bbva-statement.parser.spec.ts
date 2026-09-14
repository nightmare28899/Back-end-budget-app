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
import { BbvaStatementParser } from "./bbva-statement.parser";

function asExtractedStatement(text: string): ExtractedStatementText {
  const pages = text.split(/=== PAGE \d+ ===/);
  return {
    text,
    pages: pages.map((pageText, index) => ({
      number: index + 1,
      text: pageText.trim(),
    })),
  };
}

describe("BbvaStatementParser", () => {
  const parser = new BbvaStatementParser();
  const fixture = readFileSync(
    join(__dirname, "__fixtures__", "bbva-statement.sanitized.txt"),
    "utf8",
  );
  const extractedFixture = asExtractedStatement(fixture);

  it("admits BBVA statements and rejects other issuers", () => {
    expect(parser.canParse(extractedFixture)).toBe(true);
    expect(
      parser.canParse({ text: "BANAMEX ESTADO DE CUENTA", pages: [] }),
    ).toBe(false);
    expect(
      parser.canParse({ text: "RappiCard ESTADO DE CUENTA", pages: [] }),
    ).toBe(false);
  });

  it("extracts period, due date, and all payment targets", () => {
    const result = parser.parse(extractedFixture);

    expect(result.periodStart.toISOString()).toBe("2026-07-15T12:00:00.000Z");
    expect(result.periodEnd.toISOString()).toBe("2026-08-14T12:00:00.000Z");
    expect(result.paymentTargets.map((target) => target.kind)).toEqual([
      StatementPaymentTargetKind.NO_INTEREST,
      StatementPaymentTargetKind.MINIMUM_PLUS_INSTALLMENTS,
      StatementPaymentTargetKind.MINIMUM,
    ]);
    expect(result.paymentTargets.map((target) => target.amount)).toEqual([
      13310.66, 4848.68, 1255,
    ]);
    expect(
      result.paymentTargets.every(
        (target) =>
          target.dueDate?.toISOString() === "2026-09-03T12:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("parses signed regular transactions and ignores exchange-rate detail lines", () => {
    const result = parser.parse(extractedFixture);

    expect(result.rows).toHaveLength(9);
    expect(
      result.rows.some((row) => row.description.includes("TIPO DE CAMBIO")),
    ).toBe(false);
    expect(
      result.rows.find((row) => row.description === "BMOVIL.PAGO TDC"),
    ).toMatchObject({
      amount: 4384,
      kind: StatementRowKind.PAYMENT,
      decision: StatementRowDecision.INFO_ONLY,
    });
    expect(
      result.rows.find((row) => row.description === "CAFE EUROPA"),
    ).toMatchObject({
      amount: 119,
      kind: StatementRowKind.CHARGE,
      decision: StatementRowDecision.PENDING,
    });
    expect(
      result.rows.find((row) => row.description.startsWith("ALTA PARA MESES")),
    ).toMatchObject({
      kind: StatementRowKind.REFINANCED_PRINCIPAL,
      decision: StatementRowDecision.INFO_ONLY,
    });
  });

  it("extracts financing-plan details without turning plan balances into rows", () => {
    const result = parser.parse(extractedFixture);

    expect(result.financingPlans).toHaveLength(2);
    expect(result.financingPlans[0]).toMatchObject({
      type: StatementFinancingType.NO_INTEREST,
      merchantName: "MERCADO PAGO",
      installmentAmount: 383,
      installmentNumber: 15,
      installmentCount: 18,
    });
    expect(
      result.rows.find((row) => row.description.startsWith("15 DE 18")),
    ).toMatchObject({ section: StatementSection.FINANCING_PLAN });
  });

  it("reconciles the itemized BBVA summary", () => {
    const result = parser.parse(extractedFixture);

    expect(result.reconciliation).toMatchObject({
      openingBalance: 12199.06,
      chargesTotal: 13310.66,
      paymentsTotal: 12199.06,
      closingBalance: 13310.66,
      difference: 0,
      status: StatementReconciliationStatus.PASSED,
    });
    expect(result.warningCount).toBe(0);
  });
});
