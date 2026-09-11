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

  it("parses the sanitized section-based statement fixture", () => {
    const result = parser.parse({
      text: fixture,
      pages: [{ number: 1, text: fixture }],
    });

    expect(result.periodStart.toISOString()).toBe("2026-08-01T12:00:00.000Z");
    expect(result.periodEnd.toISOString()).toBe("2026-08-31T12:00:00.000Z");
    expect(result.reconciliation).toMatchObject({
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
