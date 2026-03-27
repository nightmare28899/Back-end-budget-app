import { Injectable } from "@nestjs/common";
import { BillingCycle, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  type BudgetPeriod,
  formatDateOnly,
  resolveBudgetWindow,
} from "../common/budget/budget.utils";

export interface CategoryBreakdownItem {
  name: string;
  icon: string;
  color: string;
  total: number;
  count: number;
  percentage: number;
}

export interface BudgetSummary {
  period: {
    type: BudgetPeriod;
    start: string;
    end: string;
  };
  totalSpent: number;
  budgetAmount: number;
  weeklyBudget: number;
  reservedSubscriptions: number;
  safeToSpend: number;
  remaining: number;
  expenseCount: number;
  dailyAverage: number;
}

export type WeeklySummary = BudgetSummary;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDailyTotals(userId: string, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const expenses = await this.prisma.expense.findMany({
      where: {
        userId,
        date: { gte: startDate, lte: endOfToday },
      },
      select: { cost: true, date: true },
      orderBy: { date: "asc" },
    });

    const dailyMap = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      dailyMap.set(d.toISOString().split("T")[0], 0);
    }

    for (const exp of expenses) {
      const key = exp.date.toISOString().split("T")[0];
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + Number(exp.cost));
    }

    return Array.from(dailyMap.entries()).map(([date, total]) => ({
      date,
      total: Math.round(total * 100) / 100,
    }));
  }

  async getCategoryBreakdown(
    userId: string,
    from?: string,
    to?: string,
  ): Promise<CategoryBreakdownItem[]> {
    const where: Prisma.ExpenseWhereInput = { userId };
    const now = new Date();

    if (from || to) {
      const dateFilter: Prisma.DateTimeFilter = {};

      if (from) {
        dateFilter.gte = new Date(from);
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.lte = toDate.getTime() <= now.getTime() ? toDate : now;
      } else {
        dateFilter.lte = now;
      }

      where.date = dateFilter;
    } else {
      where.date = { lte: now };
    }

    const expenses = await this.prisma.expense.findMany({
      where,
      include: { category: true },
    });

    const categoryMap = new Map<
      string,
      Omit<CategoryBreakdownItem, "percentage">
    >();

    for (const exp of expenses) {
      const catName = exp.category?.name ?? "Uncategorized";
      const catIcon = exp.category?.icon ?? "📦";
      const catColor = exp.category?.color ?? "#95A5A6";
      const existing = categoryMap.get(catName);

      if (existing) {
        existing.total += Number(exp.cost);
        existing.count += 1;
      } else {
        categoryMap.set(catName, {
          name: catName,
          icon: catIcon,
          color: catColor,
          total: Number(exp.cost),
          count: 1,
        });
      }
    }

    const grandTotal = Array.from(categoryMap.values()).reduce(
      (sum, c) => sum + c.total,
      0,
    );

    return Array.from(categoryMap.values())
      .map(
        (c): CategoryBreakdownItem => ({
          ...c,
          total: Math.round(c.total * 100) / 100,
          percentage:
            grandTotal > 0 ? Math.round((c.total / grandTotal) * 100) : 0,
        }),
      )
      .sort((a, b) => b.total - a.total);
  }

  async getBudgetSummary(userId: string): Promise<BudgetSummary> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        dailyBudget: true,
        budgetAmount: true,
        budgetPeriod: true,
        budgetPeriodStart: true,
        budgetPeriodEnd: true,
      },
    });

    const budgetWindow = resolveBudgetWindow({
      budgetAmount: user?.budgetAmount,
      dailyBudget: user?.dailyBudget,
      budgetPeriod: user?.budgetPeriod,
      budgetPeriodStart: user?.budgetPeriodStart,
      budgetPeriodEnd: user?.budgetPeriodEnd,
    });
    const now = new Date();
    const expenseWindowEnd =
      budgetWindow.end.getTime() <= now.getTime() ? budgetWindow.end : now;

    const expenses = await this.prisma.expense.findMany({
      where: {
        userId,
        date: { gte: budgetWindow.start, lte: expenseWindowEnd },
      },
      include: { category: true },
      orderBy: { date: "asc" },
    });

    const totalSpent = expenses.reduce((sum, exp) => sum + Number(exp.cost), 0);
    const budgetAmount = budgetWindow.amount;
    const reservedSubscriptions = await this.getReservedSubscriptionsTotal(
      userId,
      budgetWindow.start,
      budgetWindow.end,
      new Date(),
    );
    const safeToSpend = budgetAmount - totalSpent - reservedSubscriptions;

    return {
      period: {
        type: budgetWindow.period,
        start: formatDateOnly(budgetWindow.start),
        end: formatDateOnly(budgetWindow.end),
      },
      totalSpent: Math.round(totalSpent * 100) / 100,
      budgetAmount: Math.round(budgetAmount * 100) / 100,
      weeklyBudget: Math.round(budgetAmount * 100) / 100,
      reservedSubscriptions: Math.round(reservedSubscriptions * 100) / 100,
      safeToSpend: Math.round(safeToSpend * 100) / 100,
      remaining: Math.round((budgetAmount - totalSpent) * 100) / 100,
      expenseCount: expenses.length,
      dailyAverage:
        expenses.length > 0
          ? Math.round((totalSpent / budgetWindow.totalDays) * 100) / 100
          : 0,
    };
  }

  async getWeeklySummary(userId: string): Promise<WeeklySummary> {
    return this.getBudgetSummary(userId);
  }

  private async getReservedSubscriptionsTotal(
    userId: string,
    budgetStart: Date,
    budgetEnd: Date,
    now: Date,
  ) {
    const windowStart = now > budgetStart ? now : budgetStart;
    if (windowStart > budgetEnd) {
      return 0;
    }

    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        userId,
        isActive: true,
        nextPaymentDate: {
          lte: budgetEnd,
        },
      },
      select: {
        cost: true,
        billingCycle: true,
        nextPaymentDate: true,
      },
    });

    let reservedTotal = 0;
    for (const subscription of subscriptions) {
      const occurrences = this.countOccurrencesInRange(
        subscription.nextPaymentDate,
        windowStart,
        budgetEnd,
        subscription.billingCycle,
      );
      reservedTotal += Number(subscription.cost) * occurrences;
    }

    return reservedTotal;
  }

  private countOccurrencesInRange(
    firstPaymentDate: Date,
    start: Date,
    end: Date,
    cycle: BillingCycle,
  ) {
    let occurrences = 0;
    let nextDate = new Date(firstPaymentDate);

    while (nextDate < start) {
      nextDate = this.addCycle(nextDate, cycle);
    }

    while (nextDate <= end) {
      occurrences += 1;
      nextDate = this.addCycle(nextDate, cycle);
    }

    return occurrences;
  }

  private addCycle(date: Date, cycle: BillingCycle) {
    const next = new Date(date);

    switch (cycle) {
      case BillingCycle.DAILY:
        next.setDate(next.getDate() + 1);
        break;
      case BillingCycle.WEEKLY:
        next.setDate(next.getDate() + 7);
        break;
      case BillingCycle.YEARLY:
        next.setFullYear(next.getFullYear() + 1);
        break;
      case BillingCycle.MONTHLY:
      default:
        next.setMonth(next.getMonth() + 1);
        break;
    }

    return next;
  }
}
