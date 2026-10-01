import { StatementRowDecision, StatementRowKind } from "@prisma/client";

export const MATCHES_REGISTERED_EXPENSE_CODE = "MATCHES_REGISTERED_EXPENSE";

const REGULAR_MAX_DAY_DISTANCE = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface MatchableStatementRow {
  key: string;
  kind: StatementRowKind;
  decision?: StatementRowDecision | null;
  transactionDate?: Date | null;
  description: string;
  merchantName?: string | null;
  amount: number;
  currency: string;
}

export interface MatchableExpense {
  id: string;
  title: string;
  merchantName?: string | null;
  cost: number;
  currency: string;
  date: Date;
  isInstallment: boolean;
}

export interface MatchStatementRowsInput {
  rows: MatchableStatementRow[];
  expenses: MatchableExpense[];
  periodStart: Date;
  periodEnd: Date;
}

interface CandidatePair {
  rowKey: string;
  expenseId: string;
  dayDistance: number;
  similarity: number;
}

const toCents = (value: number) => Math.round(value * 100);

const utcDay = (date: Date) =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string) {
  return value.split(" ").filter((token) => token.length >= 3);
}

/** Higher is more similar; 0 means no textual overlap. */
function similarity(
  row: MatchableStatementRow,
  expense: MatchableExpense,
): number {
  const rowTexts = [row.merchantName, row.description]
    .map(normalize)
    .filter(Boolean);
  const expenseTexts = [expense.merchantName, expense.title]
    .map(normalize)
    .filter(Boolean);

  let best = 0;
  for (const rowText of rowTexts) {
    for (const expenseText of expenseTexts) {
      if (rowText.includes(expenseText) || expenseText.includes(rowText)) {
        best = Math.max(best, 100);
        continue;
      }
      const rowTokens = new Set(tokens(rowText));
      const shared = tokens(expenseText).filter((token) =>
        rowTokens.has(token),
      ).length;
      best = Math.max(best, shared);
    }
  }
  return best;
}

function isMatchableRow(row: MatchableStatementRow) {
  const decision = row.decision ?? StatementRowDecision.PENDING;
  return (
    row.kind === StatementRowKind.CHARGE &&
    (decision === StatementRowDecision.PENDING ||
      decision === StatementRowDecision.INCLUDE_EXPENSE) &&
    row.transactionDate instanceof Date &&
    toCents(row.amount) > 0
  );
}

function compareRegular(a: CandidatePair, b: CandidatePair) {
  return (
    a.dayDistance - b.dayDistance ||
    b.similarity - a.similarity ||
    a.expenseId.localeCompare(b.expenseId) ||
    a.rowKey.localeCompare(b.rowKey)
  );
}

function compareInstallment(a: CandidatePair, b: CandidatePair) {
  return (
    b.similarity - a.similarity ||
    a.dayDistance - b.dayDistance ||
    a.expenseId.localeCompare(b.expenseId) ||
    a.rowKey.localeCompare(b.rowKey)
  );
}

/**
 * Pairs statement rows with manually registered expenses so confirming an
 * import does not duplicate spending. Regular expenses match on the exact
 * amount and a date within 3 days; installment expenses match on the exact
 * per-installment amount and a payment date inside the statement period.
 * Matching is one-to-one and deterministic. Returns rowKey -> expenseId.
 */
export function matchStatementRowsToExpenses(
  input: MatchStatementRowsInput,
): Map<string, string> {
  const periodStart = utcDay(input.periodStart);
  const periodEndExclusive = utcDay(input.periodEnd) + MS_PER_DAY;
  const rows = input.rows.filter(isMatchableRow);

  const regular: CandidatePair[] = [];
  const installments: CandidatePair[] = [];

  for (const row of rows) {
    const rowDay = utcDay(row.transactionDate as Date);
    const rowCents = toCents(row.amount);
    for (const expense of input.expenses) {
      if (
        expense.currency !== row.currency ||
        toCents(expense.cost) !== rowCents
      ) {
        continue;
      }
      const expenseTime = expense.date.getTime();
      const dayDistance = Math.abs(utcDay(expense.date) - rowDay) / MS_PER_DAY;
      const pair: CandidatePair = {
        rowKey: row.key,
        expenseId: expense.id,
        dayDistance,
        similarity: similarity(row, expense),
      };
      if (expense.isInstallment) {
        if (expenseTime >= periodStart && expenseTime < periodEndExclusive) {
          installments.push(pair);
        }
      } else if (dayDistance <= REGULAR_MAX_DAY_DISTANCE) {
        regular.push(pair);
      }
    }
  }

  const matches = new Map<string, string>();
  const usedExpenses = new Set<string>();
  const assign = (pairs: CandidatePair[]) => {
    for (const pair of pairs) {
      if (matches.has(pair.rowKey) || usedExpenses.has(pair.expenseId)) {
        continue;
      }
      matches.set(pair.rowKey, pair.expenseId);
      usedExpenses.add(pair.expenseId);
    }
  };

  assign(regular.sort(compareRegular));
  assign(installments.sort(compareInstallment));
  return matches;
}
