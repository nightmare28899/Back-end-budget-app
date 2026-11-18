import {
  Prisma,
  StatementPaymentStatus,
  StatementPaymentTargetKind,
  StatementReconciliationStatus,
} from "@prisma/client";

export type StatementSummaryInput = {
  reconciliation: {
    closingBalance: Prisma.Decimal | number | string;
    currency: string;
    status: StatementReconciliationStatus;
  } | null;
  paymentTargets: Array<{
    kind: StatementPaymentTargetKind;
    amount: Prisma.Decimal | number | string;
    currency: string;
    dueDate: Date | null;
    position: number;
  }>;
  payments: Array<{
    amount: Prisma.Decimal | number | string;
    currency: string;
    voidedAt: Date | null;
  }>;
};

export type StatementPaymentSummary = {
  currency: string | null;
  closingBalance: number | null;
  paidTotal: number;
  paymentStatus: StatementPaymentStatus;
  isPaid: boolean;
  remainingStatement: number | null;
  noInterestTarget: number | null;
  remainingNoInterest: number | null;
  currentPaymentDue: number | null;
  dueDate: string | null;
  overpaid: number;
  integrityFlags: {
    missingReconciliation: boolean;
    failedReconciliation: boolean;
    missingPaymentBasis: boolean;
    conflictingNoInterestTargets: boolean;
  };
};

const toCents = (value: Prisma.Decimal | number | string) =>
  new Prisma.Decimal(value).mul(100).toDecimalPlaces(0).toNumber();

const fromCents = (value: number) => value / 100;

export function calculateStatementPaymentSummary(
  input: StatementSummaryInput,
): StatementPaymentSummary {
  const currency = input.reconciliation?.currency ?? null;
  const closingCents = input.reconciliation
    ? toCents(input.reconciliation.closingBalance)
    : null;
  const activePaymentCents = currency
    ? (input.payments ?? [])
        .filter(
          (payment) =>
            payment.voidedAt === null && payment.currency === currency,
        )
        .reduce((sum, payment) => sum + toCents(payment.amount), 0)
    : 0;
  const eligibleTargets = currency
    ? input.paymentTargets
        .filter(
          (target) =>
            target.kind === StatementPaymentTargetKind.NO_INTEREST &&
            target.currency === currency,
        )
        .sort((left, right) => left.position - right.position)
    : [];
  const targetAmounts = new Set(
    eligibleTargets.map((target) => toCents(target.amount)),
  );
  const conflictingNoInterestTargets = targetAmounts.size > 1;
  const selectedTarget = conflictingNoInterestTargets
    ? undefined
    : eligibleTargets[0];
  const targetCents = selectedTarget ? toCents(selectedTarget.amount) : null;
  const basisCents = targetCents ?? closingCents;
  const paymentStatus =
    activePaymentCents === 0
      ? StatementPaymentStatus.UNPAID
      : basisCents !== null && activePaymentCents >= basisCents
        ? StatementPaymentStatus.PAID
        : StatementPaymentStatus.PARTIAL;

  return {
    currency,
    closingBalance: closingCents === null ? null : fromCents(closingCents),
    paidTotal: fromCents(activePaymentCents),
    paymentStatus,
    isPaid: paymentStatus === StatementPaymentStatus.PAID,
    remainingStatement:
      closingCents === null
        ? null
        : fromCents(Math.max(0, closingCents - activePaymentCents)),
    noInterestTarget: targetCents === null ? null : fromCents(targetCents),
    remainingNoInterest:
      targetCents === null
        ? null
        : fromCents(Math.max(0, targetCents - activePaymentCents)),
    currentPaymentDue:
      targetCents === null
        ? closingCents === null
          ? null
          : fromCents(Math.max(0, closingCents - activePaymentCents))
        : fromCents(Math.max(0, targetCents - activePaymentCents)),
    dueDate: selectedTarget?.dueDate?.toISOString() ?? null,
    overpaid:
      closingCents === null
        ? 0
        : fromCents(Math.max(0, activePaymentCents - closingCents)),
    integrityFlags: {
      missingReconciliation: input.reconciliation === null,
      failedReconciliation:
        input.reconciliation?.status === StatementReconciliationStatus.FAILED,
      missingPaymentBasis: basisCents === null,
      conflictingNoInterestTargets,
    },
  };
}
