import {
  StatementFinancingType,
  StatementInstrumentKind,
  StatementPaymentTargetKind,
  StatementReconciliationStatus,
  StatementRowDecision,
  StatementRowKind,
  StatementSection,
} from "@prisma/client";

export interface ParsedStatementInstrument {
  position: number;
  label: string;
  kind: StatementInstrumentKind;
  last4?: string | null;
  linkedCreditCardId?: string | null;
}

export interface ParsedStatementFinancingPlan {
  position: number;
  instrumentPosition?: number | null;
  type: StatementFinancingType;
  merchantName?: string | null;
  purchaseDate?: Date | null;
  originalAmount?: number | null;
  installmentAmount?: number | null;
  installmentNumber?: number | null;
  installmentCount?: number | null;
  remainingAmount?: number | null;
  currency: string;
  sourceRowNumber?: number | null;
}

export interface ParsedStatementRow {
  occurrenceKey: string;
  section: StatementSection;
  sourceRowNumber?: number | null;
  position: number;
  transactionDate?: Date | null;
  description: string;
  merchantName?: string | null;
  amount: number;
  currency: string;
  kind: StatementRowKind;
  decision?: StatementRowDecision;
  categoryId?: string | null;
  linkedCreditCardId?: string | null;
  financingPlanPosition?: number | null;
  warningCodes?: string[];
  rawText?: string | null;
}

export interface ParsedStatementPaymentTarget {
  position: number;
  kind: StatementPaymentTargetKind;
  label: string;
  amount: number;
  currency: string;
  dueDate?: Date | null;
  sourceRowNumber?: number | null;
}

export interface ParsedStatementData {
  parserVersion: string;
  periodStart: Date;
  periodEnd: Date;
  warningCount: number;
  reconciliation: {
    openingBalance: number;
    chargesTotal: number;
    paymentsTotal: number;
    creditsTotal: number;
    closingBalance: number;
    difference: number;
    status: StatementReconciliationStatus;
    message?: string | null;
  };
  instruments: ParsedStatementInstrument[];
  financingPlans: ParsedStatementFinancingPlan[];
  paymentTargets: ParsedStatementPaymentTarget[];
  rows: ParsedStatementRow[];
}
