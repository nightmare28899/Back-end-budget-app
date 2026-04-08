import { BadRequestException } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { formatDateOnly } from "../common/budget/budget.utils";

describe("AnalyticsService", () => {
  type ExpenseWhere = {
    where: {
      date?: {
        gte: Date;
        lte: Date;
      };
      categoryId?: unknown;
    };
  };

  type ExpenseRow = {
    cost: number;
    date: Date;
    categoryId?: string | null;
    category?: {
      name?: string | null;
      icon?: string | null;
      color?: string | null;
    } | null;
  };

  type SubscriptionRow = {
    id: string;
    name: string;
    cost: number;
    currency: string;
    billingCycle: "MONTHLY" | "YEARLY" | "WEEKLY" | "DAILY";
    nextPaymentDate: Date;
  };

  type CategoryRow = {
    id: string;
    name: string;
    icon?: string | null;
    color?: string | null;
    budgetAmount?: number | null;
  };

  type UserBudgetRow = {
    dailyBudget?: number | null;
    budgetAmount?: number | null;
    budgetPeriod?: string | null;
    budgetPeriodStart?: Date | null;
    budgetPeriodEnd?: Date | null;
  };

  const expenseFindMany = jest.fn<Promise<ExpenseRow[]>, [ExpenseWhere]>();
  const subscriptionFindMany = jest.fn<Promise<SubscriptionRow[]>, [unknown]>();
  const categoryFindMany = jest.fn<Promise<CategoryRow[]>, [unknown]>();
  const userFindUnique = jest.fn<Promise<UserBudgetRow | null>, [unknown]>();
  const prisma = {
    expense: {
      findMany: expenseFindMany,
    },
    subscription: {
      findMany: subscriptionFindMany,
    },
    category: {
      findMany: categoryFindMany,
    },
    user: {
      findUnique: userFindUnique,
    },
  };

  let service: AnalyticsService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 3, 7, 10, 0, 0, 0));
    expenseFindMany.mockReset();
    subscriptionFindMany.mockReset();
    categoryFindMany.mockReset();
    userFindUnique.mockReset();
    service = new AnalyticsService(prisma as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("builds the daily totals window up to the requested anchor date", async () => {
    expenseFindMany.mockResolvedValue([
      { cost: 120, date: new Date(2026, 3, 5, 9, 0, 0, 0) },
      { cost: 80, date: new Date(2026, 3, 7, 11, 0, 0, 0) },
    ]);

    const result = await service.getDailyTotals("user-1", 3, "2026-04-07");

    const [{ where }] = expenseFindMany.mock.calls[0];
    expect(formatDateOnly(where.date.gte)).toBe("2026-04-05");
    expect(formatDateOnly(where.date.lte)).toBe("2026-04-07");
    expect(result).toEqual([
      { date: "2026-04-05", total: 120 },
      { date: "2026-04-06", total: 0 },
      { date: "2026-04-07", total: 80 },
    ]);
  });

  it("rejects future anchor dates", async () => {
    await expect(
      service.getDailyTotals("user-1", 7, "2026-04-08"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("builds actionable insights for weekly, monthly, and subscription savings", async () => {
    expenseFindMany.mockResolvedValue([
      {
        cost: 100,
        date: new Date(2026, 3, 1, 9, 0, 0, 0),
        category: { name: "Food", icon: "restaurant", color: "#FFAA00" },
      },
      {
        cost: 60,
        date: new Date(2026, 3, 6, 9, 0, 0, 0),
        category: { name: "Food", icon: "restaurant", color: "#FFAA00" },
      },
      {
        cost: 90,
        date: new Date(2026, 3, 7, 8, 30, 0, 0),
        category: { name: "Bills", icon: "receipt", color: "#3366FF" },
      },
      {
        cost: 80,
        date: new Date(2026, 2, 31, 9, 0, 0, 0),
        category: { name: "Food", icon: "restaurant", color: "#FFAA00" },
      },
      {
        cost: 40,
        date: new Date(2026, 2, 3, 9, 0, 0, 0),
        category: { name: "Transport", icon: "car", color: "#00AAFF" },
      },
    ]);
    subscriptionFindMany.mockResolvedValue([
      {
        id: "sub-1",
        name: "Netflix",
        cost: 199,
        currency: "MXN",
        billingCycle: "MONTHLY",
        nextPaymentDate: new Date(2026, 3, 10, 12, 0, 0, 0),
      },
      {
        id: "sub-2",
        name: "Gym",
        cost: 1200,
        currency: "MXN",
        billingCycle: "YEARLY",
        nextPaymentDate: new Date(2026, 4, 2, 12, 0, 0, 0),
      },
    ]);

    const result = await service.getInsights("user-1", "2026-04-07", 6);

    expect(result.referenceDate).toBe("2026-04-07");
    expect(result.weeklySpend.totalSpent).toBe(150);
    expect(result.weeklySpend.previousTotalSpent).toBe(80);
    expect(result.weeklySpend.changeAmount).toBe(70);
    expect(result.monthlySpend.totalSpent).toBe(250);
    expect(result.monthlySpend.previousTotalSpent).toBe(40);
    expect(result.monthlySpend.projectedTotal).toBe(1071.43);
    expect(result.topCategory).toEqual({
      name: "Food",
      icon: "restaurant",
      color: "#FFAA00",
      total: 160,
      percentage: 64,
    });
    expect(result.subscriptionSavings.monthlyRecurringSpend).toBe(299);
    expect(result.subscriptionSavings.projectedSavings).toBe(1794);
    expect(result.subscriptionSavings.topSubscriptions[0]).toMatchObject({
      id: "sub-1",
      name: "Netflix",
      monthlyEquivalent: 199,
      projectedSavings: 1194,
    });
    expect(result.subscriptionSavings.topSubscriptions[1]).toMatchObject({
      id: "sub-2",
      name: "Gym",
      monthlyEquivalent: 100,
      projectedSavings: 600,
    });
  });

  it("builds category budget statuses inside the current spending plan window", async () => {
    userFindUnique.mockResolvedValue({
      budgetAmount: 3000,
      dailyBudget: 3000,
      budgetPeriod: "monthly",
      budgetPeriodStart: null,
      budgetPeriodEnd: null,
    });
    categoryFindMany.mockResolvedValue([
      {
        id: "food",
        name: "Food",
        icon: "restaurant",
        color: "#FFAA00",
        budgetAmount: 900,
      },
      {
        id: "transport",
        name: "Transport",
        icon: "car",
        color: "#00AAFF",
        budgetAmount: 200,
      },
      {
        id: "fun",
        name: "Fun",
        icon: "game-controller",
        color: "#AA66FF",
        budgetAmount: null,
      },
    ]);
    expenseFindMany.mockResolvedValue([
      { cost: 520, date: new Date(2026, 3, 2, 9, 0, 0, 0), categoryId: "food" },
      {
        cost: 280,
        date: new Date(2026, 3, 5, 12, 0, 0, 0),
        categoryId: "food",
      },
      {
        cost: 240,
        date: new Date(2026, 3, 6, 8, 30, 0, 0),
        categoryId: "transport",
      },
      { cost: 120, date: new Date(2026, 3, 7, 8, 30, 0, 0), categoryId: "fun" },
    ]);

    const result = await service.getCategoryBudgets("user-1", "2026-04-07");

    expect(result.period).toEqual({
      type: "monthly",
      start: "2026-04-01",
      end: "2026-04-30",
    });
    expect(result.totalBudgeted).toBe(1100);
    expect(result.totalSpentBudgeted).toBe(1040);
    expect(result.totalRemaining).toBe(60);
    expect(result.categoriesWithBudget).toBe(2);
    expect(result.overBudgetCount).toBe(1);
    expect(result.watchCount).toBe(1);
    expect(result.items.slice(0, 3)).toEqual([
      expect.objectContaining({
        categoryId: "transport",
        budgetAmount: 200,
        spent: 240,
        remaining: -40,
        percentage: 120,
        status: "off_track",
      }),
      expect.objectContaining({
        categoryId: "food",
        budgetAmount: 900,
        spent: 800,
        remaining: 100,
        percentage: 88.9,
        status: "watch",
      }),
      expect.objectContaining({
        categoryId: "fun",
        budgetAmount: 0,
        spent: 120,
        remaining: 0,
        percentage: 0,
        status: "no_budget",
      }),
    ]);
  });
});
