import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface CategoryBreakdownItem {
  name: string;
  icon: string;
  color: string;
  total: number;
  count: number;
  percentage: number;
}

export interface WeeklySummary {
  period: {
    start: string;
    end: string;
  };
  totalSpent: number;
  weeklyBudget: number;
  remaining: number;
  expenseCount: number;
  dailyAverage: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDailyTotals(userId: string, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const expenses = await this.prisma.expense.findMany({
      where: {
        userId,
        date: { gte: startDate },
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

    if (from || to) {
      const dateFilter: Prisma.DateTimeFilter = {};

      if (from) {
        dateFilter.gte = new Date(from);
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.lte = toDate;
      }

      where.date = dateFilter;
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

  async getWeeklySummary(userId: string): Promise<WeeklySummary> {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const expenses = await this.prisma.expense.findMany({
      where: {
        userId,
        date: { gte: startOfWeek, lte: endOfWeek },
      },
      include: { category: true },
      orderBy: { date: "asc" },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { dailyBudget: true },
    });

    const totalSpent = expenses.reduce((sum, exp) => sum + Number(exp.cost), 0);

    const weeklyBudget = Number(user?.dailyBudget ?? 0) * 7;

    return {
      period: {
        start: startOfWeek.toISOString().split("T")[0],
        end: endOfWeek.toISOString().split("T")[0],
      },
      totalSpent: Math.round(totalSpent * 100) / 100,
      weeklyBudget: Math.round(weeklyBudget * 100) / 100,
      remaining: Math.round((weeklyBudget - totalSpent) * 100) / 100,
      expenseCount: expenses.length,
      dailyAverage:
        expenses.length > 0 ? Math.round((totalSpent / 7) * 100) / 100 : 0,
    };
  }
}
