jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { ReportsService } from "./reports.service";

describe("ReportsService", () => {
  type MoneyQuery = {
    where: {
      userId: string;
      date: {
        gte: Date;
        lte: Date;
      };
    };
  };
  type ReportHistoryCreateArgs = {
    data: {
      periodType: string;
      source: string;
      referenceDate: Date;
      reportStart: Date;
      reportEnd: Date;
      snapshot: unknown;
      user: {
        connect: {
          id: string;
        };
      };
    };
  };
  type ReportHistoryRecord = {
    id: string;
    periodType: string;
    source: string;
    referenceDate: Date;
    reportStart: Date;
    reportEnd: Date;
    snapshot: unknown;
    createdAt: Date;
  };

  const expenseFindMany = jest.fn<
    Promise<Array<{ cost: number }>>,
    [MoneyQuery]
  >();
  const incomeFindMany = jest.fn<
    Promise<Array<{ amount: number }>>,
    [MoneyQuery]
  >();
  const reportHistoryCreate = jest.fn<
    Promise<ReportHistoryRecord>,
    [ReportHistoryCreateArgs]
  >();
  const reportHistoryFindMany = jest.fn();
  const savingsGoalFindMany = jest.fn();
  const userFindUnique = jest.fn();
  const analyticsService = {
    getCategoryBreakdown: jest.fn(),
    getBudgetSummary: jest.fn(),
    getCategoryBudgets: jest.fn(),
    getInsights: jest.fn(),
  };
  const configService = {
    get: jest.fn(),
  };
  const prisma = {
    expense: { findMany: expenseFindMany },
    income: { findMany: incomeFindMany },
    reportHistory: {
      create: reportHistoryCreate,
      findMany: reportHistoryFindMany,
    },
    savingsGoal: { findMany: savingsGoalFindMany },
    user: { findUnique: userFindUnique },
  };

  let service: ReportsService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 3, 8, 10, 0, 0, 0));
    expenseFindMany.mockReset();
    incomeFindMany.mockReset();
    reportHistoryCreate.mockReset();
    reportHistoryFindMany.mockReset();
    savingsGoalFindMany.mockReset();
    userFindUnique.mockReset();
    analyticsService.getCategoryBreakdown.mockReset();
    analyticsService.getBudgetSummary.mockReset();
    analyticsService.getCategoryBudgets.mockReset();
    analyticsService.getInsights.mockReset();
    configService.get.mockReset();

    service = new ReportsService(
      prisma as never,
      analyticsService as never,
      configService as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("builds a weekly report snapshot from week start to the selected day", async () => {
    expenseFindMany.mockResolvedValue([{ cost: 250 }, { cost: 150 }]);
    incomeFindMany.mockResolvedValue([{ amount: 1200 }]);
    savingsGoalFindMany.mockResolvedValue([
      {
        id: "goal-1",
        title: "Vacation",
        targetAmount: 5000,
        currentAmount: 1200,
        targetDate: new Date(2026, 4, 15, 12, 0, 0, 0),
      },
    ]);
    analyticsService.getCategoryBreakdown.mockResolvedValue([
      {
        name: "Food",
        icon: "restaurant",
        color: "#FFAA00",
        total: 280,
        count: 2,
        percentage: 70,
      },
    ]);
    analyticsService.getBudgetSummary.mockResolvedValue({
      period: {
        type: "monthly",
        start: "2026-04-01",
        end: "2026-04-30",
      },
      totalSpent: 800,
      budgetAmount: 3000,
      weeklyBudget: 700,
      reservedSubscriptions: 320,
      safeToSpend: 2680,
      remaining: 2200,
      expenseCount: 8,
      dailyAverage: 100,
    });
    analyticsService.getCategoryBudgets.mockResolvedValue({
      overBudgetCount: 1,
      watchCount: 2,
    });
    analyticsService.getInsights.mockResolvedValue({
      referenceDate: "2026-04-08",
      weeklySpend: {
        start: "2026-04-06",
        end: "2026-04-08",
        totalSpent: 400,
        expenseCount: 2,
        averagePerDay: 133.3,
        previousStart: "2026-03-30",
        previousEnd: "2026-04-01",
        previousTotalSpent: 260,
        changeAmount: 140,
        changePercent: 53.8,
      },
      monthlySpend: {
        start: "2026-04-01",
        end: "2026-04-08",
        totalSpent: 800,
        expenseCount: 8,
        averagePerDay: 100,
        previousStart: "2026-03-01",
        previousEnd: "2026-03-08",
        previousTotalSpent: 620,
        changeAmount: 180,
        changePercent: 29,
        projectedTotal: 3000,
      },
      topCategory: {
        name: "Food",
        icon: "restaurant",
        color: "#FFAA00",
        total: 280,
        percentage: 35,
      },
      subscriptionSavings: {
        horizonMonths: 6,
        monthlyRecurringSpend: 399,
        projectedSavings: 2394,
        activeSubscriptions: 3,
        topSubscriptions: [],
      },
    });

    const result = await service.getSummary("user-1", {
      periodType: "weekly",
      referenceDate: "2026-04-08",
      horizonMonths: 6,
    });

    const expenseQuery = expenseFindMany.mock.calls[0]?.[0];
    const incomeQuery = incomeFindMany.mock.calls[0]?.[0];

    expect(expenseQuery.where.date.gte).toEqual(
      new Date(2026, 3, 6, 0, 0, 0, 0),
    );
    expect(expenseQuery.where.date.lte).toEqual(
      new Date(2026, 3, 8, 23, 59, 59, 999),
    );
    expect(incomeQuery.where.date.gte).toEqual(
      new Date(2026, 3, 6, 0, 0, 0, 0),
    );
    expect(result.report).toEqual({
      type: "weekly",
      label: "Weekly",
      referenceDate: "2026-04-08",
      start: "2026-04-06",
      end: "2026-04-08",
      trackedDays: 3,
    });
    expect(result.summary).toEqual({
      totalIncome: 1200,
      incomeCount: 1,
      averageIncome: 1200,
      totalSpent: 400,
      expenseCount: 2,
      averagePerDay: 133.33,
      net: 800,
      savingsRate: 66.7,
    });
    expect(result.categoryBudgets).toEqual({
      overBudgetCount: 1,
      watchCount: 2,
    });
    expect(result.savings).toEqual({
      goalCount: 1,
      totalSaved: 1200,
      totalTarget: 5000,
      progressPercent: 24,
      nextGoal: {
        id: "goal-1",
        title: "Vacation",
        targetDate: "2026-05-15",
        currentAmount: 1200,
        targetAmount: 5000,
      },
    });
    expect(result.highlights.suggestedSavingsMove).toBe(160);
  });

  it("saves a report snapshot and returns a history entry", async () => {
    expenseFindMany.mockResolvedValue([{ cost: 120 }]);
    incomeFindMany.mockResolvedValue([{ amount: 900 }]);
    savingsGoalFindMany.mockResolvedValue([]);
    analyticsService.getCategoryBreakdown.mockResolvedValue([]);
    analyticsService.getBudgetSummary.mockResolvedValue({
      period: {
        type: "monthly",
        start: "2026-04-01",
        end: "2026-04-30",
      },
      totalSpent: 500,
      budgetAmount: 2000,
      weeklyBudget: 500,
      reservedSubscriptions: 200,
      safeToSpend: 1800,
      remaining: 1500,
      expenseCount: 4,
      dailyAverage: 62.5,
    });
    analyticsService.getCategoryBudgets.mockResolvedValue({
      overBudgetCount: 0,
      watchCount: 1,
    });
    analyticsService.getInsights.mockResolvedValue({
      referenceDate: "2026-04-08",
      weeklySpend: {
        start: "2026-04-06",
        end: "2026-04-08",
        totalSpent: 120,
        expenseCount: 1,
        averagePerDay: 40,
        previousStart: "2026-03-30",
        previousEnd: "2026-04-01",
        previousTotalSpent: 80,
        changeAmount: 40,
        changePercent: 50,
      },
      monthlySpend: {
        start: "2026-04-01",
        end: "2026-04-08",
        totalSpent: 500,
        expenseCount: 4,
        averagePerDay: 62.5,
        previousStart: "2026-03-01",
        previousEnd: "2026-03-08",
        previousTotalSpent: 450,
        changeAmount: 50,
        changePercent: 11.1,
        projectedTotal: 1875,
      },
      topCategory: null,
      subscriptionSavings: {
        horizonMonths: 6,
        monthlyRecurringSpend: 99,
        projectedSavings: 594,
        activeSubscriptions: 1,
        topSubscriptions: [],
      },
    });
    reportHistoryCreate.mockImplementation(({ data }) =>
      Promise.resolve({
        id: "history-1",
        periodType: data.periodType,
        source: data.source,
        referenceDate: data.referenceDate,
        reportStart: data.reportStart,
        reportEnd: data.reportEnd,
        snapshot: data.snapshot,
        createdAt: new Date("2026-04-08T10:00:00.000Z"),
      }),
    );

    const item = await service.saveSummary("user-1", {
      periodType: "weekly",
      referenceDate: "2026-04-08",
      source: "manual",
    });

    expect(reportHistoryCreate).toHaveBeenCalled();
    expect(item).toEqual({
      id: "history-1",
      periodType: "weekly",
      source: "manual",
      referenceDate: "2026-04-08",
      start: "2026-04-06",
      end: "2026-04-08",
      createdAt: "2026-04-08T10:00:00.000Z",
      summary: {
        totalIncome: 900,
        incomeCount: 1,
        averageIncome: 900,
        totalSpent: 120,
        expenseCount: 1,
        averagePerDay: 40,
        net: 780,
        savingsRate: 86.7,
      },
    });
  });
});
