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
      currency: "MXN",
      openingBalance: 12199.06,
      chargesTotal: 13310.66,
      paymentsTotal: 12199.06,
      closingBalance: 13310.66,
      difference: 0,
      status: StatementReconciliationStatus.PASSED,
    });
    expect(result.warningCount).toBe(0);
  });

  describe("installment layout (synthetic)", () => {
    const installmentFixture = readFileSync(
      join(
        __dirname,
        "__fixtures__",
        "bbva-statement.installments.synthetic.txt",
      ),
      "utf8",
    );
    const extracted = asExtractedStatement(installmentFixture);

    it("parses the accented due date with footnote digit and weekday", () => {
      const result = parser.parse(extracted);

      expect(result.paymentTargets).toHaveLength(3);
      expect(
        result.paymentTargets.every(
          (target) =>
            target.dueDate?.toISOString() === "2027-03-01T12:00:00.000Z",
        ),
      ).toBe(true);
    });

    it("parses single-line, multi-line and interest-bearing plan entries", () => {
      const result = parser.parse(extracted);

      expect(result.financingPlans).toHaveLength(3);
      expect(result.financingPlans[0]).toMatchObject({
        type: StatementFinancingType.NO_INTEREST,
        merchantName: "STORE ALPHA",
        purchaseDate: new Date("2026-06-10T12:00:00.000Z"),
        originalAmount: 1200,
        remainingAmount: 600,
        installmentAmount: 100,
        installmentNumber: 6,
        installmentCount: 12,
        currency: "MXN",
      });
      expect(result.financingPlans[1]).toMatchObject({
        type: StatementFinancingType.NO_INTEREST,
        merchantName: "STORE BETA WITH A LONG DESCRIPTION CONTINUED",
        originalAmount: 2400,
        remainingAmount: 1200,
        installmentAmount: 200,
        installmentNumber: 7,
        installmentCount: 12,
      });
      expect(result.financingPlans[2]).toMatchObject({
        type: StatementFinancingType.INTEREST_BEARING,
        merchantName: "STORE GAMMA",
        originalAmount: 1000,
        remainingAmount: 300.5,
        installmentAmount: 105.8,
        installmentNumber: 8,
        installmentCount: 10,
      });
    });

    it("never turns plan entries or regular-section rows into the wrong thing", () => {
      const result = parser.parse(extracted);

      expect(
        result.rows.some((row) => row.description.includes("STORE GAMMA")),
      ).toBe(false);
      expect(result.rows).toHaveLength(3);
      expect(
        result.financingPlans.every((plan) => (plan.sourceRowNumber ?? 0) > 0),
      ).toBe(true);
    });

    it("keeps installment billing rows as informational rows", () => {
      const result = parser.parse(extracted);
      const installments = result.rows.filter((row) =>
        /^\d{2} DE \d{2}\b/.test(row.description),
      );

      expect(installments).toHaveLength(2);
      for (const row of installments) {
        expect(row).toMatchObject({
          section: StatementSection.FINANCING_PLAN,
          kind: StatementRowKind.REFINANCED_PRINCIPAL,
          decision: StatementRowDecision.INFO_ONLY,
          warningCodes: ["DEBT_AMORTIZATION_NOT_EXPENSE"],
        });
      }
      expect(
        result.rows.find((row) => row.description === "CORNER CAFE"),
      ).toMatchObject({
        kind: StatementRowKind.CHARGE,
        decision: StatementRowDecision.PENDING,
        warningCodes: [],
      });
    });

    it("raises no warning when plan balances match 'Saldo cargo a meses'", () => {
      const result = parser.parse(extracted);

      expect(result.reconciliation.status).toBe(
        StatementReconciliationStatus.PASSED,
      );
      expect(result.warningCount).toBe(0);
    });

    it("warns when plan balances differ from 'Saldo cargo a meses'", () => {
      const result = parser.parse(
        asExtractedStatement(
          installmentFixture.replace(
            "Saldo cargo a meses: $2,100.50",
            "Saldo cargo a meses: $2,000.00",
          ),
        ),
      );

      expect(result.warningCount).toBe(1);
    });

    it("does not warn about plan balances when the label is absent", () => {
      const result = parser.parse(
        asExtractedStatement(
          installmentFixture.replace(/^Saldo cargo a meses:.*\n/m, ""),
        ),
      );

      expect(result.warningCount).toBe(0);
    });
  });
});
