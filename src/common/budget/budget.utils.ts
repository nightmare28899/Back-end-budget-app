export const BUDGET_PERIOD_VALUES = [
  "daily",
  "weekly",
  "monthly",
  "annual",
  "period",
] as const;

export type BudgetPeriod = (typeof BUDGET_PERIOD_VALUES)[number];

export const DEFAULT_BUDGET_PERIOD: BudgetPeriod = "daily";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export interface BudgetConfigInput {
  budgetAmount?: unknown;
  dailyBudget?: unknown;
  budgetPeriod?: string | null;
  budgetPeriodStart?: Date | string | null;
  budgetPeriodEnd?: Date | string | null;
}

export interface BudgetWindow {
  period: BudgetPeriod;
  amount: number;
  start: Date;
  end: Date;
  totalDays: number;
}

export function normalizeBudgetPeriod(raw?: string | null): BudgetPeriod {
  if (!raw) {
    return DEFAULT_BUDGET_PERIOD;
  }

  const normalized = raw.trim().toLowerCase();
  return isBudgetPeriod(normalized) ? normalized : DEFAULT_BUDGET_PERIOD;
}

export function isBudgetPeriod(value: string): value is BudgetPeriod {
  return (BUDGET_PERIOD_VALUES as readonly string[]).includes(value);
}

export function getBudgetPeriodLabel(period: BudgetPeriod): string {
  switch (period) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "annual":
      return "Annual";
    case "period":
      return "Custom Period";
    default:
      return "Daily";
  }
}

export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveBudgetWindow(
  config: BudgetConfigInput,
  now = new Date(),
): BudgetWindow {
  const period = normalizeBudgetPeriod(config.budgetPeriod);
  const amount = Math.max(
    0,
    Number(
      config.budgetAmount ??
        config.dailyBudget ??
        0,
    ),
  );

  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  switch (period) {
    case "daily":
      return withWindow(period, amount, todayStart, todayEnd);
    case "weekly": {
      const dayOfWeek = now.getDay();
      const start = startOfDay(new Date(now));
      start.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      const end = endOfDay(new Date(start));
      end.setDate(start.getDate() + 6);
      return withWindow(period, amount, start, end);
    }
    case "monthly": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      return withWindow(period, amount, start, end);
    }
    case "annual": {
      const start = new Date(now.getFullYear(), 0, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now.getFullYear(), 11, 31);
      end.setHours(23, 59, 59, 999);
      return withWindow(period, amount, start, end);
    }
    case "period": {
      const start = parseDate(config.budgetPeriodStart) ?? todayStart;
      const end = parseDate(config.budgetPeriodEnd) ?? start;
      const normalizedStart = startOfDay(start);
      const normalizedEnd = endOfDay(end);
      if (normalizedEnd < normalizedStart) {
        return withWindow(period, amount, todayStart, todayEnd);
      }
      return withWindow(period, amount, normalizedStart, normalizedEnd);
    }
    default:
      return withWindow(DEFAULT_BUDGET_PERIOD, amount, todayStart, todayEnd);
  }
}

function withWindow(
  period: BudgetPeriod,
  amount: number,
  start: Date,
  end: Date,
): BudgetWindow {
  const totalDays = Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / DAY_IN_MS) + 1,
  );

  return { period, amount, start, end, totalDays };
}

function parseDate(raw?: Date | string | null): Date | null {
  if (!raw) {
    return null;
  }

  const date =
    raw instanceof Date
      ? raw
      : createDateFromString(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function createDateFromString(raw: string): Date {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    return new Date(year, month, day);
  }

  return new Date(raw);
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}
