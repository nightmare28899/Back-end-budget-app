import { Injectable } from "@nestjs/common";
import { PaymentMethod, StatementFinancingType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type ExpenseFinancingPlan = {
  type: StatementFinancingType;
  installmentNumber: number | null;
  installmentCount: number | null;
  installmentAmount: number | null;
  originalAmount: number | null;
  remainingAmount: number | null;
  purchaseDate: string | null;
};

export type FinancingPlanCandidate = {
  type: StatementFinancingType;
  merchantName: string | null;
  purchaseDate: Date | null;
  originalAmount: number | null;
  installmentAmount: number | null;
  installmentNumber: number | null;
  installmentCount: number | null;
  remainingAmount: number | null;
  creditCardId: string | null;
  statementPeriodEnd: Date | null;
  statementCreatedAt: Date | null;
};

export type MatchableExpense = {
  cost: unknown;
  date: Date;
  paymentMethod: PaymentMethod | null;
  creditCardId?: string | null;
  merchantName?: string | null;
  title?: string | null;
};

const AMOUNT_TOLERANCE = 0.01;
const MAX_DAY_DISTANCE = 3;
const MIN_TOKEN_LENGTH = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
const MERCHANT_PREFIX = /\b(?:MERPAGO|MERCADOPAGO|MERCADO PAGO|MP)\s*\*/g;
const STOPWORDS = new Set([
  "MESES",
  "SIN",
  "INTERESES",
  "COMPRA",
  "PAGO",
  "CARGO",
  "REFA",
]);

export function normalizeMerchant(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(MERCHANT_PREFIX, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function significantTokens(normalized: string): Set<string> {
  return new Set(
    normalized
      .split(" ")
      .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t)),
  );
}

export function merchantsMatch(
  planMerchant: string | null | undefined,
  candidates: Array<string | null | undefined>,
): boolean {
  const planNorm = normalizeMerchant(planMerchant);
  if (!planNorm) return false;
  const planTokens = significantTokens(planNorm);

  for (const candidate of candidates) {
    const norm = normalizeMerchant(candidate);
    if (!norm) continue;
    const shorter = norm.length <= planNorm.length ? norm : planNorm;
    const longer = shorter === norm ? planNorm : norm;
    if (shorter.length >= MIN_TOKEN_LENGTH && longer.includes(shorter)) {
      return true;
    }
    for (const token of significantTokens(norm)) {
      if (planTokens.has(token)) return true;
    }
  }
  return false;
}

function dayNumber(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isCandidateBetter(
  a: FinancingPlanCandidate,
  b: FinancingPlanCandidate,
): boolean {
  const an = a.installmentNumber ?? -1;
  const bn = b.installmentNumber ?? -1;
  if (an !== bn) return an > bn;
  const ap = a.statementPeriodEnd?.getTime() ?? 0;
  const bp = b.statementPeriodEnd?.getTime() ?? 0;
  if (ap !== bp) return ap > bp;
  return (
    (a.statementCreatedAt?.getTime() ?? 0) >
    (b.statementCreatedAt?.getTime() ?? 0)
  );
}

export function planMatchesExpense(
  plan: FinancingPlanCandidate,
  expense: MatchableExpense,
): boolean {
  if (
    plan.creditCardId &&
    expense.creditCardId &&
    plan.creditCardId !== expense.creditCardId
  ) {
    return false;
  }

  const hasPlanDate = plan.purchaseDate !== null;
  if (hasPlanDate) {
    const distance = Math.abs(
      dayNumber(plan.purchaseDate as Date) - dayNumber(expense.date),
    );
    if (distance > MAX_DAY_DISTANCE) return false;
  }

  if (plan.originalAmount !== null) {
    if (
      Math.round(Math.abs(plan.originalAmount - Number(expense.cost)) * 100) >
      Math.round(AMOUNT_TOLERANCE * 100)
    ) {
      return false;
    }
  } else if (!hasPlanDate) {
    // Nothing but a merchant to go on: too weak.
    return false;
  }

  if (!plan.merchantName) {
    // No merchant to compare: only trust a plan with both amount and date.
    return hasPlanDate && plan.originalAmount !== null;
  }
  return merchantsMatch(plan.merchantName, [
    expense.merchantName,
    expense.title,
  ]);
}

export function toExpenseFinancingPlan(
  plan: FinancingPlanCandidate,
): ExpenseFinancingPlan {
  return {
    type: plan.type,
    installmentNumber: plan.installmentNumber,
    installmentCount: plan.installmentCount,
    installmentAmount: plan.installmentAmount,
    originalAmount: plan.originalAmount,
    remainingAmount: plan.remainingAmount,
    purchaseDate: plan.purchaseDate ? toDateOnly(plan.purchaseDate) : null,
  };
}

export function findBestFinancingPlan(
  expense: MatchableExpense,
  plans: FinancingPlanCandidate[],
): ExpenseFinancingPlan | null {
  if (expense.paymentMethod !== PaymentMethod.CREDIT_CARD) return null;
  let best: FinancingPlanCandidate | null = null;
  for (const plan of plans) {
    if (!planMatchesExpense(plan, expense)) continue;
    if (!best || isCandidateBetter(plan, best)) best = plan;
  }
  return best ? toExpenseFinancingPlan(best) : null;
}

export function attachFinancingPlans<T extends MatchableExpense>(
  expenses: T[],
  plans: FinancingPlanCandidate[],
): Array<T & { financingPlan: ExpenseFinancingPlan | null }> {
  return expenses.map((expense) => ({
    ...expense,
    financingPlan: findBestFinancingPlan(expense, plans),
  }));
}

const toNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

@Injectable()
export class FinancingPlanMatcherService {
  constructor(private readonly prisma: PrismaService) {}

  async loadPlans(userId: string): Promise<FinancingPlanCandidate[]> {
    const rows = await this.prisma.statementFinancingPlan.findMany({
      where: { statementImport: { userId } },
      select: {
        type: true,
        merchantName: true,
        purchaseDate: true,
        originalAmount: true,
        installmentAmount: true,
        installmentNumber: true,
        installmentCount: true,
        remainingAmount: true,
        statementImport: {
          select: { creditCardId: true, periodEnd: true, createdAt: true },
        },
      },
    });
    return rows.map((row) => ({
      type: row.type,
      merchantName: row.merchantName,
      purchaseDate: row.purchaseDate,
      originalAmount: toNumber(row.originalAmount),
      installmentAmount: toNumber(row.installmentAmount),
      installmentNumber: row.installmentNumber,
      installmentCount: row.installmentCount,
      remainingAmount: toNumber(row.remainingAmount),
      creditCardId: row.statementImport.creditCardId ?? null,
      statementPeriodEnd: row.statementImport.periodEnd ?? null,
      statementCreatedAt: row.statementImport.createdAt ?? null,
    }));
  }

  /** One plans query per call; skipped when no credit-card expense is present. */
  async enrich<T extends MatchableExpense>(
    userId: string,
    expenses: T[],
  ): Promise<Array<T & { financingPlan: ExpenseFinancingPlan | null }>> {
    const hasCreditCard = expenses.some(
      (e) => e.paymentMethod === PaymentMethod.CREDIT_CARD,
    );
    if (!hasCreditCard) return attachFinancingPlans(expenses, []);
    return attachFinancingPlans(expenses, await this.loadPlans(userId));
  }
}
