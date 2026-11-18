import { Prisma } from "@prisma/client";
import { ExpensePaymentStatus } from "./dto/query-expense.dto";
import { ExpensesService } from "./expenses.service";
import { FinancingPlanMatcherService } from "./financing-plan-matcher";

describe("ExpensesService", () => {
  type WhereCall = [{ where: Prisma.ExpenseWhereInput }];
  const expenseFindMany = jest.fn<Promise<unknown>, WhereCall>();
  const expenseCount = jest.fn<Promise<unknown>, WhereCall>();
  const expenseAggregate = jest.fn<Promise<unknown>, WhereCall>();
  const expenseGroupBy = jest.fn<Promise<unknown>, WhereCall>();
  const planFindMany = jest.fn<Promise<unknown>, [unknown]>();
  const prisma = {
    statementFinancingPlan: { findMany: planFindMany },
    expense: {
      findMany: expenseFindMany,
      count: expenseCount,
      aggregate: expenseAggregate,
      groupBy: expenseGroupBy,
    },
  };

  let service: ExpensesService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-21T12:00:00.000Z"));
    jest.clearAllMocks();
    expenseFindMany.mockResolvedValue([]);
    expenseCount.mockResolvedValue(0);
    expenseAggregate.mockResolvedValue({ _sum: { cost: null } });
    expenseGroupBy.mockResolvedValue([]);
    planFindMany.mockResolvedValue([]);
    service = new ExpensesService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      new FinancingPlanMatcherService(prisma as never),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function getWhereArguments(): Prisma.ExpenseWhereInput[] {
    return [
      expenseFindMany.mock.calls[0][0].where,
      expenseCount.mock.calls[0][0].where,
      expenseAggregate.mock.calls[0][0].where,
      expenseGroupBy.mock.calls[0][0].where,
    ];
  }

  it("leaves the statement relation filter absent when payment status is omitted", async () => {
    await service.findAll("user-1", {});

    const [where] = getWhereArguments();
    expect(where).toEqual({
      userId: "user-1",
      date: { lte: new Date("2026-09-21T12:00:00.000Z") },
    });
    expect(where).not.toHaveProperty("statementRow");
  });

  it("filters by creditCardId when provided", async () => {
    await service.findAll("user-1", { creditCardId: "card-1" });

    const [where] = getWhereArguments();
    expect(where.creditCardId).toBe("card-1");
  });

  it("maps PAID to a statement row whose statement is paid", async () => {
    await service.findAll("user-1", {
      paymentStatus: ExpensePaymentStatus.PAID,
    });

    const [where] = getWhereArguments();
    expect(where.statementRow).toEqual({
      is: {
        statementImport: {
          is: { paymentStatus: "PAID" },
        },
      },
    });
  });

  it("maps UNPAID to an unpaid statement row OR an un-reconciled credit-card expense", async () => {
    await service.findAll("user-1", {
      paymentStatus: ExpensePaymentStatus.UNPAID,
    });

    const [where] = getWhereArguments();
    expect(where.statementRow).toBeUndefined();
    expect(where.AND).toEqual([
      {
        OR: [
          {
            statementRow: {
              is: { statementImport: { is: { paymentStatus: "UNPAID" } } },
            },
          },
          { statementRow: null, paymentMethod: "CREDIT_CARD" },
        ],
      },
    ]);
  });

  it("combines UNPAID with the text search filter instead of clobbering it", async () => {
    await service.findAll("user-1", {
      q: "coffee",
      paymentStatus: ExpensePaymentStatus.UNPAID,
    });

    const [where] = getWhereArguments();
    expect(where.OR).toHaveLength(5);
    expect(where.AND).toEqual([
      {
        OR: [
          {
            statementRow: {
              is: { statementImport: { is: { paymentStatus: "UNPAID" } } },
            },
          },
          { statementRow: null, paymentMethod: "CREDIT_CARD" },
        ],
      },
    ]);
  });

  it("passes the exact same combined where object to list and every summary query", async () => {
    await service.findAll("user-1", {
      from: "2026-09-01",
      to: "2026-09-15",
      q: "coffee",
      categoryId: "category-1",
      paymentStatus: ExpensePaymentStatus.PAID,
      page: 2,
      limit: 10,
    });

    const [listWhere, countWhere, aggregateWhere, groupByWhere] =
      getWhereArguments();
    expect(countWhere).toBe(listWhere);
    expect(aggregateWhere).toBe(listWhere);
    expect(groupByWhere).toBe(listWhere);
    expect(listWhere).toMatchObject({
      userId: "user-1",
      categoryId: "category-1",
      date: {
        gte: new Date("2026-09-01T00:00:00.000Z"),
        lte: new Date("2026-09-15T23:59:59.999Z"),
      },
      statementRow: {
        is: {
          statementImport: {
            is: { paymentStatus: "PAID" },
          },
        },
      },
    });
    expect(listWhere.OR).toHaveLength(5);
    expect(expenseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it("maps PARTIAL only to linked partial statements", async () => {
    await service.findAll("user-1", {
      paymentStatus: ExpensePaymentStatus.PARTIAL,
    });

    const [where] = getWhereArguments();
    expect(where.statementRow).toEqual({
      is: {
        statementImport: {
          is: { paymentStatus: "PARTIAL" },
        },
      },
    });
    expect(where.AND).toBeUndefined();
  });

  it("uses inclusive UTC boundaries for a same-day range", async () => {
    await service.findAll("user-1", {
      from: "2026-09-15",
      to: "2026-09-15",
    });

    const [where] = getWhereArguments();
    expect(where.date).toEqual({
      gte: new Date("2026-09-15T00:00:00.000Z"),
      lte: new Date("2026-09-15T23:59:59.999Z"),
    });
  });

  it("uses the full inclusive UTC range for separate from and to dates", async () => {
    await service.findAll("user-1", {
      from: "2026-08-31",
      to: "2026-09-01",
    });

    const [where] = getWhereArguments();
    expect(where.date).toEqual({
      gte: new Date("2026-08-31T00:00:00.000Z"),
      lte: new Date("2026-09-01T23:59:59.999Z"),
    });
  });

  it("normalizes a full ISO from value to the UTC day of its instant", async () => {
    await service.findAll("user-1", {
      from: "2026-09-15T23:30:00.000-05:00",
    });

    const [where] = getWhereArguments();
    expect(where.date).toEqual({
      gte: new Date("2026-09-16T00:00:00.000Z"),
      lte: new Date("2026-09-21T12:00:00.000Z"),
    });
  });

  it("normalizes a full ISO to value to the UTC day of its instant", async () => {
    await service.findAll("user-1", {
      to: "2026-09-14T23:30:00.000-05:00",
    });

    const [where] = getWhereArguments();
    expect(where.date).toEqual({
      lte: new Date("2026-09-15T23:59:59.999Z"),
    });
  });

  it("clamps a future UTC end boundary to the current instant", async () => {
    await service.findAll("user-1", {
      from: "2026-09-21",
      to: "2026-09-30",
    });

    const [where] = getWhereArguments();
    expect(where.date).toEqual({
      gte: new Date("2026-09-21T00:00:00.000Z"),
      lte: new Date("2026-09-21T12:00:00.000Z"),
    });
  });

  describe("financingPlan enrichment", () => {
    const creditCardExpense = {
      id: "e1",
      cost: "12999",
      date: new Date("2026-03-10T12:00:00.000Z"),
      paymentMethod: "CREDIT_CARD",
      creditCardId: "card-1",
      merchantName: "Amazon",
      title: "Amazon MX",
    };
    const planRow = {
      type: "NO_INTEREST",
      merchantName: "AMAZON A MESES",
      purchaseDate: new Date("2026-03-09T00:00:00.000Z"),
      originalAmount: "12999.00",
      installmentAmount: "1083.25",
      installmentNumber: 7,
      installmentCount: 12,
      remainingAmount: null,
      statementImport: {
        creditCardId: "card-1",
        periodEnd: new Date("2026-09-30T00:00:00.000Z"),
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    };

    it("attaches financingPlan to list responses with one plans query", async () => {
      expenseFindMany.mockResolvedValue([
        creditCardExpense,
        { ...creditCardExpense, id: "e2", cost: "5" },
      ]);
      planFindMany.mockResolvedValue([planRow]);

      const result = await service.findAll("user-1", {});

      expect(planFindMany).toHaveBeenCalledTimes(1);
      expect(result.expenses[0]).toMatchObject({
        id: "e1",
        financingPlan: {
          type: "NO_INTEREST",
          installmentNumber: 7,
          installmentCount: 12,
          installmentAmount: 1083.25,
          originalAmount: 12999,
          remainingAmount: null,
          purchaseDate: "2026-03-09",
        },
      });
      expect(result.expenses[1].financingPlan).toBeNull();
    });

    it("skips the plans query when no credit-card expense is listed", async () => {
      expenseFindMany.mockResolvedValue([
        { ...creditCardExpense, paymentMethod: "CASH" },
      ]);

      const result = await service.findAll("user-1", {});

      expect(planFindMany).not.toHaveBeenCalled();
      expect(result.expenses[0].financingPlan).toBeNull();
    });
  });
});
