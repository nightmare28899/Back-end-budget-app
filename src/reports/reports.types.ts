import type {
  AnalyticsInsights,
  BudgetSummary,
  CategoryBreakdownItem,
} from "../analytics/analytics.service";

export const REPORT_PERIOD_TYPES = ["weekly", "monthly"] as const;

export type ReportPeriodType = (typeof REPORT_PERIOD_TYPES)[number];
export type ReportHistorySource = "manual" | "email";

export interface ReportWindowSnapshot {
  type: ReportPeriodType;
  label: string;
  referenceDate: string;
  start: string;
  end: string;
  trackedDays: number;
}

export interface ReportSummarySnapshot {
  totalIncome: number;
  incomeCount: number;
  averageIncome: number;
  totalSpent: number;
  expenseCount: number;
  averagePerDay: number;
  net: number;
  savingsRate: number | null;
}

export interface ReportSavingsSnapshot {
  goalCount: number;
  totalSaved: number;
  totalTarget: number;
  progressPercent: number | null;
  nextGoal: {
    id: string;
    title: string;
    targetDate: string | null;
    currentAmount: number;
    targetAmount: number;
  } | null;
}

export interface ReportSnapshot {
  generatedAt: string;
  report: ReportWindowSnapshot;
  summary: ReportSummarySnapshot;
  plan: BudgetSummary;
  categoryBudgets: {
    overBudgetCount: number;
    watchCount: number;
  };
  categories: CategoryBreakdownItem[];
  insights: AnalyticsInsights;
  savings: ReportSavingsSnapshot;
  highlights: {
    suggestedSavingsMove: number;
  };
}

export interface ReportHistoryItem {
  id: string;
  periodType: ReportPeriodType;
  source: ReportHistorySource;
  referenceDate: string;
  start: string;
  end: string;
  createdAt: string;
  summary: ReportSummarySnapshot;
}
