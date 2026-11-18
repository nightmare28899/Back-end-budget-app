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
    join(
      __dirname,
      "__fixtures__",
      "rappicard-statement-desglose.sanitized.txt",
    ),
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
      currency: "MXN",
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
      result.paymentTargets.every(
        (target) =>
          target.dueDate?.toISOString() === "2026-09-04T12:00:00.000Z",
      ),
    ).toBe(true);

    expect(
      result.rows.filter(
        (row) => row.section === StatementSection.CURRENT_CHARGES,
      ),
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
      currency: "MXN",
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

  describe("installment-plan tables (real layout)", () => {
    const planHeader = [
      "Fecha de la",
      "operación Descripción Monto",
      "original Saldo",
      "pendiente Pago",
      "requerido Núm. de",
      "pago",
    ];

    function buildStatement(
      balanceLine: string | null,
    ): ExtractedStatementText {
      const page1 = [
        "Estado de cuenta",
        "Tarjeta de credito RappiCard",
        "Periodo 16-jul-2030 al 15-ago-2030",
        "Fecha limite de pago1 viernes, 04-sep-2030",
        "Pago para no generar intereses2 $1,000.00",
        "Pago minimo4 $400.00",
        "Saldo cargos regulares: $100.00",
        ...(balanceLine ? [balanceLine] : []),
        "Saldo deudor total11 $1,856.93",
      ];
      const page3 = [
        "Número de cuenta: 000000000000000001 Página 3 de 9",
        'Ver notas en la sección "NOTAS ACLARATORIAS" en este estado de cuenta. Notas:',
        "DESGLOSE DE MOVIMIENTOS",
        "COMPRAS Y CARGOS DIFERIDOS A MESES SIN INTERESES",
        "Tarjeta digital titular : **** **** **** 1111",
        ...planHeader,
        "2030-01-",
        "05 TIENDA UNO; RFC:",
        "AAA000000AA0 $300.00 $200.00 $100.00 1 de 3 0.00%",
        "2030-01-",
        "10",
        "TIENDA DOS; RFC:",
        "AAA000000AA0",
        "$600.00 $400.00 $200.00 1 de 3 0.00%",
        "2029-06-16 TIENDA TRES A MESES $1,200.00 $600.00 $100.00 6 de 12 0.00%",
        "COMPRAS Y CARGOS DIFERIDOS A MESES CON INTERESES",
        "Tarjeta digital titular : **** **** **** 1111",
        ...planHeader,
        "2030-01-08 TIENDA CUATRO;",
        "RFC: AAA000000AA0",
        "$525.00 $186.27 $23.76 $3.80 $198.52 2 de 3 78.96%",
        "2029-12-11 Servicio Demo de",
        "Prueba",
        "$629.00 $0.00 $13.14 $2.10 $234.97 3 de 3 71.04%",
      ];
      const page4 = [
        "Número de cuenta: 000000000000000001 Página 4 de 9",
        'Ver notas en la sección "NOTAS ACLARATORIAS" en este estado de cuenta. Notas:',
        "COMPRAS Y CARGOS DIFERIDOS A MESES CON INTERESES",
        "Tarjeta física titular : **** **** **** 2222",
        ...planHeader,
        "2030-01-02 TIENDA CINCO;",
        "RFC:",
        "AAA000000AA0",
        "$539.00 $370.66 $35.47 $5.68 $203.81 1 de 3 78.96%",
        "CARGOS, ABONOS Y COMPRAS REGULARES (NO A MESES)",
        "Tarjeta física titular : **** **** **** 2222",
        "Fecha de la",
        "operación Fecha cargo Descripción del movimiento Monto",
        "2030-07-17 2030-07-18 CAFETERIA LUNA; RFC: AAA000000AA0 +$100.00",
        "2030-07-18 2030-07-18 IVA INTERES COMPRA EN CUOTAS 1 DE 3 +$5.68",
      ];
      const pages = [page1, page3, page4].map((lines, index) => ({
        number: index + 1,
        text: lines.join("\n"),
      }));
      return { text: pages.map((page) => page.text).join("\n"), pages };
    }

    const matchingBalance = "Saldo cargos a meses: $1,756.93";
    const plansOf = () =>
      parser.parse(buildStatement(matchingBalance)).financingPlans;

    it("parses every plan of both tables across instruments and pages", () => {
      expect(plansOf()).toHaveLength(6);
      expect(plansOf().map((plan) => plan.position)).toEqual([
        0, 1, 2, 3, 4, 5,
      ]);
    });

    it("joins split dates, multi-line descriptions and inline amounts (no-interest)", () => {
      const [first, second, third] = plansOf();

      expect(first).toMatchObject({
        type: StatementFinancingType.NO_INTEREST,
        purchaseDate: new Date("2030-01-05T12:00:00.000Z"),
        merchantName: "TIENDA UNO",
        originalAmount: 300,
        remainingAmount: 200,
        installmentAmount: 100,
        installmentNumber: 1,
        installmentCount: 3,
        currency: "MXN",
      });
      expect(second).toMatchObject({
        purchaseDate: new Date("2030-01-10T12:00:00.000Z"),
        merchantName: "TIENDA DOS",
        originalAmount: 600,
        remainingAmount: 400,
        installmentAmount: 200,
      });
      expect(third).toMatchObject({
        purchaseDate: new Date("2029-06-16T12:00:00.000Z"),
        merchantName: "TIENDA TRES A MESES",
        originalAmount: 1200,
        remainingAmount: 600,
        installmentAmount: 100,
        installmentNumber: 6,
        installmentCount: 12,
      });
    });

    it("reads the interest-bearing layout (interest and VAT columns before the required payment)", () => {
      const [, , , fourth, fifth, sixth] = plansOf();

      expect(fourth).toMatchObject({
        type: StatementFinancingType.INTEREST_BEARING,
        merchantName: "TIENDA CUATRO",
        originalAmount: 525,
        remainingAmount: 186.27,
        installmentAmount: 198.52,
        installmentNumber: 2,
        installmentCount: 3,
      });
      expect(fifth).toMatchObject({
        type: StatementFinancingType.INTEREST_BEARING,
        merchantName: "Servicio Demo de Prueba",
        originalAmount: 629,
        remainingAmount: 0,
        installmentAmount: 234.97,
      });
      expect(sixth).toMatchObject({
        type: StatementFinancingType.INTEREST_BEARING,
        merchantName: "TIENDA CINCO",
        originalAmount: 539,
        remainingAmount: 370.66,
        installmentAmount: 203.81,
      });
    });

    it("keeps plans out of the statement rows and stops at the regular charges section", () => {
      const result = parser.parse(buildStatement(matchingBalance));

      expect(result.rows).toHaveLength(2);
      expect(
        result.rows.every(
          (row) => row.section === StatementSection.CURRENT_CHARGES,
        ),
      ).toBe(true);
      expect(
        result.rows.every((row) => row.financingPlanPosition === undefined),
      ).toBe(true);
    });

    it("adds no warning when plan remaining balances match 'Saldo cargos a meses'", () => {
      const matching = parser.parse(buildStatement(matchingBalance));
      const missingTotal = parser.parse(buildStatement(null));

      expect(matching.warningCount).toBe(missingTotal.warningCount);
    });

    it("adds one warning when plan remaining balances differ from 'Saldo cargos a meses'", () => {
      const matching = parser.parse(buildStatement(matchingBalance));
      const mismatch = parser.parse(
        buildStatement("Saldo cargos a meses: $1,999.99"),
      );

      expect(mismatch.financingPlans).toHaveLength(6);
      expect(mismatch.warningCount).toBe(matching.warningCount + 1);
    });

    it("does not crash on truncated or unexpected plan layouts", () => {
      const text = [
        "Estado de cuenta",
        "Tarjeta de credito RappiCard",
        "Periodo 16-jul-2030 al 15-ago-2030",
        "DESGLOSE DE MOVIMIENTOS",
        "2030-07-17 2030-07-18 CAFETERIA LUNA +$100.00",
        "COMPRAS Y CARGOS DIFERIDOS A MESES SIN INTERESES",
        "2030-01-",
        "05 TIENDA UNO; RFC:",
        "unexpected text without amounts",
        "more text",
        "2030-01-",
        "GLOSARIO DE TERMINOS Y ABREVIATURAS",
        "2030-01-09 TEXTO DE GLOSARIO $1.00 $2.00 1 de 3 0.00%",
      ].join("\n");

      const result = parser.parse({
        text,
        pages: [{ number: 1, text }],
      });

      expect(result.financingPlans).toEqual([]);
      expect(result.rows).toHaveLength(1);
    });
  });
});
