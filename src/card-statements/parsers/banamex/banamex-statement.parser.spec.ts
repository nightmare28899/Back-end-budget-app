import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  StatementFinancingType,
  StatementInstrumentKind,
  StatementPaymentTargetKind,
  StatementReconciliationStatus,
  StatementRowDecision,
  StatementRowKind,
  StatementSection,
} from "@prisma/client";
import { BanamexStatementParser } from "./banamex-statement.parser";

describe("BanamexStatementParser", () => {
  const parser = new BanamexStatementParser();
  const fixture = readFileSync(
    join(__dirname, "__fixtures__", "banamex-statement.sanitized.txt"),
    "utf8",
  );
  const costcoFixture = readFileSync(
    join(__dirname, "__fixtures__", "banamex-statement-costco.sanitized.txt"),
    "utf8",
  );
  const costcoDesgloseFixture = readFileSync(
    join(
      __dirname,
      "__fixtures__",
      "banamex-statement-costco-desglose.sanitized.txt",
    ),
    "utf8",
  );

  it("parses the sanitized section-based statement fixture", () => {
    const result = parser.parse({
      text: fixture,
      pages: [{ number: 1, text: fixture }],
    });

    expect(result.periodStart.toISOString()).toBe("2026-08-01T12:00:00.000Z");
    expect(result.periodEnd.toISOString()).toBe("2026-08-31T12:00:00.000Z");
    expect(result.reconciliation).toMatchObject({
      currency: "MXN",
      status: StatementReconciliationStatus.PASSED,
      difference: 0,
      openingBalance: 5000,
      closingBalance: 8000,
    });
    expect(result.paymentTargets.map((target) => target.kind)).toEqual([
      StatementPaymentTargetKind.MINIMUM,
      StatementPaymentTargetKind.MINIMUM_PLUS_INSTALLMENTS,
      StatementPaymentTargetKind.NO_INTEREST,
    ]);
    expect(result.instruments).toEqual([
      expect.objectContaining({
        kind: StatementInstrumentKind.PHYSICAL,
        last4: "1111",
      }),
      expect.objectContaining({
        kind: StatementInstrumentKind.DIGITAL,
        last4: "2222",
      }),
    ]);
    expect(result.financingPlans).toHaveLength(2);
    expect(result.financingPlans[0]).toMatchObject({
      type: StatementFinancingType.NO_INTEREST,
      installmentNumber: 2,
      installmentCount: 6,
      installmentAmount: 500,
    });
  });

  it("parses the Costco co-branded layout (colon-separated header, DD-MMM-YYYY dates)", () => {
    const result = parser.parse({
      text: costcoFixture,
      pages: [{ number: 1, text: costcoFixture }],
    });

    expect(result.periodStart.toISOString()).toBe("2026-07-22T12:00:00.000Z");
    expect(result.periodEnd.toISOString()).toBe("2026-08-21T12:00:00.000Z");
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("parses the Costco layout that uses a 'DESGLOSE DE MOVIMIENTOS' section header and an interest-bearing installments section", () => {
    const result = parser.parse({
      text: costcoDesgloseFixture,
      pages: [{ number: 1, text: costcoDesgloseFixture }],
    });

    expect(result.periodStart.toISOString()).toBe("2026-07-22T12:00:00.000Z");
    expect(result.periodEnd.toISOString()).toBe("2026-08-21T12:00:00.000Z");
    expect(
      result.rows.filter(
        (row) => row.section === StatementSection.CURRENT_CHARGES,
      ),
    ).toHaveLength(2);
    expect(result.reconciliation).toMatchObject({
      currency: "MXN",
      status: StatementReconciliationStatus.PASSED,
      openingBalance: 5000,
      chargesTotal: 4000,
      paymentsTotal: 1000,
      closingBalance: 8000,
    });
    expect(result.financingPlans).toHaveLength(1);
    expect(result.financingPlans[0]).toMatchObject({
      type: StatementFinancingType.INTEREST_BEARING,
      installmentNumber: 2,
      installmentCount: 6,
      installmentAmount: 750,
    });
  });

  describe("deferred-balance layout with footnoted headers", () => {
    const deferredFixture = readFileSync(
      join(
        __dirname,
        "__fixtures__",
        "banamex-statement-deferred-balance.sanitized.txt",
      ),
      "utf8",
    );
    const parseDeferred = () =>
      parser.parse({
        text: deferredFixture,
        pages: [{ number: 1, text: deferredFixture }],
      });

    it("reads the due date after a footnote digit and a weekday", () => {
      const result = parseDeferred();

      expect(result.paymentTargets[0]?.dueDate?.toISOString()).toBe(
        "2026-10-12T12:00:00.000Z",
      );
    });

    it("classifies the minimum-plus-deferred target separately from the minimum", () => {
      const result = parseDeferred();

      expect(
        result.paymentTargets.map((target) => [target.kind, target.amount]),
      ).toEqual([
        [StatementPaymentTargetKind.NO_INTEREST, 2000],
        [StatementPaymentTargetKind.MINIMUM_PLUS_INSTALLMENTS, 900],
        [StatementPaymentTargetKind.MINIMUM, 500],
      ]);
    });

    it("returns to regular charges after the 'no a meses' header", () => {
      const result = parseDeferred();

      expect(result.rows.map((row) => row.section)).toEqual(
        result.rows.map(() => StatementSection.CURRENT_CHARGES),
      );
      expect(result.rows.map((row) => row.amount)).toEqual([
        1000, 500, 10, 90, 400,
      ]);
    });

    it("parses multi-line installment plans with balances and required payment", () => {
      const result = parseDeferred();

      expect(result.financingPlans).toHaveLength(2);
      expect(result.financingPlans[0]).toMatchObject({
        position: 0,
        type: StatementFinancingType.INTEREST_BEARING,
        merchantName: "DIFERIMIENTO DE SALDO APP MOBILE",
        originalAmount: 4000,
        remainingAmount: 2800,
        installmentAmount: 400,
        installmentNumber: 4,
        installmentCount: 12,
        currency: "MXN",
      });
      expect(result.financingPlans[0].purchaseDate?.toISOString()).toBe(
        "2026-09-21T12:00:00.000Z",
      );
      expect(result.financingPlans[1]).toMatchObject({
        position: 1,
        merchantName: "COMPRA PLAN PERSONAL TIENDA DE PRUEBA PLAZA CENTRAL",
        originalAmount: 1200,
        remainingAmount: 800,
        installmentAmount: 150,
        installmentNumber: 5,
        installmentCount: 12,
      });
    });

    it("parses no-interest plan tables without interest columns", () => {
      const text = [
        "BANAMEX",
        "Periodo: 22-ago-2026 al 21-sep-2026",
        "COMPRAS A MESES SIN INTERESES",
        "10-sep-2026 TIENDA DE PRUEBA",
        "PLAN MESES",
        "$3,000.00 $2,000.00 $500.00 2 de 6",
        "CARGOS, ABONOS Y COMPRAS REGULARES (NO A MESES)",
        "24-ago-2026 25-ago-2026 SUPERMERCADO DE PRUEBA + $500.00",
      ].join("\n");
      const result = parser.parse({ text, pages: [{ number: 1, text }] });

      expect(result.financingPlans).toHaveLength(1);
      expect(result.financingPlans[0]).toMatchObject({
        type: StatementFinancingType.NO_INTEREST,
        originalAmount: 3000,
        remainingAmount: 2000,
        installmentAmount: 500,
        installmentNumber: 2,
        installmentCount: 6,
      });
      expect(result.rows).toHaveLength(1);
    });

    it("keeps deferred-balance installments out of expense candidates", () => {
      const result = parseDeferred();
      const deferred = result.rows.find((row) =>
        row.description.startsWith("DIFERIMIENTO DE SALDO"),
      );

      expect(deferred).toMatchObject({
        kind: StatementRowKind.REFINANCED_PRINCIPAL,
        decision: StatementRowDecision.INFO_ONLY,
        warningCodes: ["DEBT_AMORTIZATION_NOT_EXPENSE"],
      });
    });
  });

  it("preserves repeated installments as separate source occurrences", () => {
    const result = parser.parse({
      text: fixture,
      pages: [{ number: 1, text: fixture }],
    });
    const installments = result.rows.filter(
      (row) => row.description === "TIENDA EQUIPO 02 DE 06",
    );

    expect(installments).toHaveLength(2);
    expect(installments[0].occurrenceKey).not.toBe(
      installments[1].occurrenceKey,
    );
    expect(
      installments.every((row) =>
        row.warningCodes?.includes("REPEATED_LOOKING_OCCURRENCE"),
      ),
    ).toBe(true);
  });

  it("keeps payment and CFDI evidence out of expense candidates", () => {
    const result = parser.parse({
      text: fixture,
      pages: [{ number: 1, text: fixture }],
    });
    const payment = result.rows.find(
      (row) => row.kind === StatementRowKind.PAYMENT,
    );
    const cfdi = result.rows.find(
      (row) => row.section === StatementSection.CFDI,
    );

    expect(payment?.decision).toBe(StatementRowDecision.INFO_ONLY);
    expect(cfdi).toMatchObject({
      kind: StatementRowKind.CFDI,
      decision: StatementRowDecision.INFO_ONLY,
    });
  });

  it("rejects documents from unsupported issuers", () => {
    expect(() =>
      parser.parse({
        text: "OTHER BANK\nPERIODO DEL 01/08/2026 AL 31/08/2026",
        pages: [],
      }),
    ).toThrow("not a supported Banamex statement");
  });
});
