import { BadRequestException, Injectable } from "@nestjs/common";
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

  async getDailyTotals(userId: string, days = 7, endDate?: string) {
    const safeDays = Math.max(days, 1);
    const windowEnd = this.getAnalyticsReferenceNow(endDate, "endDate");

    const startDate = this.startOfDay(windowEnd);
    startDate.setDate(startDate.getDate() - (safeDays - 1));

    const expenses = await this.prisma.expense.findMany({
      where: {
        userId,
        date: { gte: startDate, lte: windowEnd },
      },
      select: { cost: true, date: true },
      orderBy: { date: "asc" },
    });

    const dailyMap = new Map<string, number>();
    for (let i = 0; i < safeDays; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      dailyMap.set(formatDateOnly(d), 0);
    }

    for (const exp of expenses) {
      const key = formatDateOnly(exp.date);
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
    referenceDate?: string,
  ): Promise<CategoryBreakdownItem[]> {
    const where: Prisma.ExpenseWhereInput = { userId };
    const now = new Date();

    if (from || to) {
      const dateFilter: Prisma.DateTimeFilter = {};

      if (from) {
        dateFilter.gte = this.startOfDay(this.parseAnalyticsDate(from, "from"));
      }
      if (to) {
        const toDate = this.endOfDay(this.parseAnalyticsDate(to, "to"));
        dateFilter.lte = toDate.getTime() <= now.getTime() ? toDate : now;
      } else {
        dateFilter.lte = now;
      }

      where.date = dateFilter;
    } else if (referenceDate) {
      const user = await this.getBudgetConfig(userId);
      const analyticsNow = this.getAnalyticsReferenceNow(
        referenceDate,
        "referenceDate",
      );
      const budgetWindow = resolveBudgetWindow(
        {
          budgetAmount: user?.budgetAmount,
          dailyBudget: user?.dailyBudget,
          budgetPeriod: user?.budgetPeriod,
          budgetPeriodStart: user?.budgetPeriodStart,
          budgetPeriodEnd: user?.budgetPeriodEnd,
        },
        analyticsNow,
      );
      const scopedEnd =
        budgetWindow.end.getTime() <= analyticsNow.getTime()
          ? budgetWindow.end
          : analyticsNow;

      where.date = {
        gte: budgetWindow.start,
        lte: scopedEnd,
      };
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

  async getBudgetSummary(
    userId: string,
    referenceDate?: string,
  ): Promise<BudgetSummary> {
    const user = await this.getBudgetConfig(userId);
    const analyticsNow = this.getAnalyticsReferenceNow(
      referenceDate,
      "referenceDate",
    );

    const budgetWindow = resolveBudgetWindow(
      {
        budgetAmount: user?.budgetAmount,
        dailyBudget: user?.dailyBudget,
        budgetPeriod: user?.budgetPeriod,
        budgetPeriodStart: user?.budgetPeriodStart,
        budgetPeriodEnd: user?.budgetPeriodEnd,
      },
      analyticsNow,
    );
    const expenseWindowEnd =
      budgetWindow.end.getTime() <= analyticsNow.getTime()
        ? budgetWindow.end
        : analyticsNow;

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
      analyticsNow,
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

  async getWeeklySummary(
    userId: string,
    referenceDate?: string,
  ): Promise<WeeklySummary> {
    return this.getBudgetSummary(userId, referenceDate);
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

  private async getBudgetConfig(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        dailyBudget: true,
        budgetAmount: true,
        budgetPeriod: true,
        budgetPeriodStart: true,
        budgetPeriodEnd: true,
      },
    });
  }

  private getAnalyticsReferenceNow(raw?: string, fieldName = "referenceDate") {
    const now = new Date();
    if (!raw) {
      return now;
    }

    const parsed = this.parseAnalyticsDate(raw, fieldName);
    if (this.startOfDay(parsed).getTime() > this.startOfDay(now).getTime()) {
      throw new BadRequestException(
        `${fieldName} cannot be greater than the current date`,
      );
    }

    const endOfSelectedDay = this.endOfDay(parsed);
    return endOfSelectedDay.getTime() <= now.getTime() ? endOfSelectedDay : now;
  }

  private parseAnalyticsDate(raw: string, fieldName: string) {
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]) - 1;
      const day = Number(match[3]);
      return new Date(year, month, day, 12, 0, 0, 0);
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} is invalid`);
    }

    return parsed;
  }

  private startOfDay(date: Date) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
  }

  private endOfDay(date: Date) {
    const next = new Date(date);
    next.setHours(23, 59, 59, 999);
    return next;
  }
}
