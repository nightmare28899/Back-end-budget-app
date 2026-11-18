import {
  StatementPaymentStatus,
  StatementPaymentTargetKind,
  StatementReconciliationStatus,
} from "@prisma/client";
import {
  calculateStatementPaymentSummary,
  type StatementSummaryInput,
} from "./statement-payment-summary";

describe("calculateStatementPaymentSummary", () => {
  it.each([
    [0, StatementPaymentStatus.UNPAID, 300],
    [100, StatementPaymentStatus.PARTIAL, 200],
    [300, StatementPaymentStatus.PAID, 0],
    [550, StatementPaymentStatus.PAID, 0],
  ])(
    "derives target-first status for a %s payment",
    (paidTotal, paymentStatus, remainingNoInterest) => {
      const result = calculateStatementPaymentSummary(
        input({ paidTotal, closingBalance: 500, targetAmounts: [300] }),
      );

      expect(result).toMatchObject({
        paidTotal,
        paymentStatus,
        remainingNoInterest,
        remainingStatement: Math.max(0, 500 - paidTotal),
        overpaid: Math.max(0, paidTotal - 500),
      });
      expect(result.isPaid).toBe(paymentStatus === StatementPaymentStatus.PAID);
    },
  );

  it("uses closing balance as status basis when no no-interest target exists", () => {
    const result = calculateStatementPaymentSummary(
      input({ paidTotal: 200, closingBalance: 500, targetAmounts: [] }),
    );

    expect(result).toMatchObject({
      paymentStatus: StatementPaymentStatus.PARTIAL,
      noInterestTarget: null,
      remainingNoInterest: null,
      currentPaymentDue: 300,
    });
  });

  it("tolerates equal duplicate targets deterministically", () => {
    const result = calculateStatementPaymentSummary(
      input({ paidTotal: 100, closingBalance: 500, targetAmounts: [300, 300] }),
    );

    expect(result.noInterestTarget).toBe(300);
    expect(result.integrityFlags.conflictingNoInterestTargets).toBe(false);
  });

  it("flags conflicting equal-priority targets without choosing a value", () => {
    const result = calculateStatementPaymentSummary(
      input({ paidTotal: 100, closingBalance: 500, targetAmounts: [300, 350] }),
    );

    expect(result.noInterestTarget).toBeNull();
    expect(result.remainingNoInterest).toBeNull();
    expect(result.integrityFlags.conflictingNoInterestTargets).toBe(true);
  });

  it("reports a missing basis when reconciliation is unavailable", () => {
    const base = input({
      paidTotal: 0,
      closingBalance: 500,
      targetAmounts: [],
    });
    base.reconciliation = null;

    expect(calculateStatementPaymentSummary(base)).toMatchObject({
      currency: null,
      closingBalance: null,
      paidTotal: 0,
      paymentStatus: StatementPaymentStatus.UNPAID,
      remainingStatement: null,
      currentPaymentDue: null,
      integrityFlags: {
        missingReconciliation: true,
        missingPaymentBasis: true,
      },
    });
  });

  it("excludes voided and foreign-currency payments", () => {
    const base = input({
      paidTotal: 100,
      closingBalance: 500,
      targetAmounts: [],
    });
    base.payments.push(
      { amount: 75, currency: "MXN", voidedAt: new Date() },
      { amount: 50, currency: "USD", voidedAt: null },
    );

    expect(calculateStatementPaymentSummary(base).paidTotal).toBe(100);
  });

  function input(options: {
    paidTotal: number;
    closingBalance: number;
    targetAmounts: number[];
  }): StatementSummaryInput {
    return {
      reconciliation: {
        closingBalance: options.closingBalance,
        currency: "MXN",
        status: StatementReconciliationStatus.PASSED,
      },
      paymentTargets: options.targetAmounts.map((amount, position) => ({
        kind: StatementPaymentTargetKind.NO_INTEREST,
        amount,
        currency: "MXN",
        dueDate: new Date(
          `2026-10-${String(position + 1).padStart(2, "0")}T00:00:00.000Z`,
        ),
        position,
      })),
      payments:
        options.paidTotal > 0
          ? [{ amount: options.paidTotal, currency: "MXN", voidedAt: null }]
          : [],
    };
  }
});
