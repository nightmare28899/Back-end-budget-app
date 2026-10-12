import { IncomesService } from "./incomes.service";

type AnyArgs = { where: Record<string, unknown>; by?: string[] };

describe("IncomesService.getSummary", () => {
  const userFindUnique = jest.fn();
  const incomeAggregate = jest.fn<Promise<unknown>, [AnyArgs]>();
  const incomeCount = jest.fn<Promise<unknown>, [AnyArgs]>();
  const incomeGroupBy = jest.fn<Promise<unknown>, [AnyArgs]>();
  const expenseAggregate = jest.fn<Promise<unknown>, [AnyArgs]>();
  const expenseGroupBy = jest.fn<Promise<unknown>, [AnyArgs]>();
  const prisma = {
    user: { findUnique: userFindUnique },
    income: {
      aggregate: incomeAggregate,
      count: incomeCount,
      groupBy: incomeGroupBy,
    },
    expense: { aggregate: expenseAggregate, groupBy: expenseGroupBy },
  };
  let service: IncomesService;

  beforeEach(() => {
    jest.clearAllMocks();
    userFindUnique.mockResolvedValue({
      dailyBudget: null,
      budgetAmount: null,
      budgetPeriod: null,
      budgetPeriodStart: null,
      budgetPeriodEnd: null,
    });
    incomeAggregate.mockResolvedValue({ _sum: { amount: 1000 } });
    incomeCount.mockResolvedValue(2);
    expenseAggregate.mockResolvedValue({ _sum: { cost: 400 } });
    incomeGroupBy.mockResolvedValue([]);
    expenseGroupBy.mockResolvedValue([]);
    service = new IncomesService(prisma as never);
  });

  it("legacy path: no currency filter, no extra keys, no groupBy", async () => {
    const result = await service.getSummary("u1", "2026-04-08");

    expect(result).not.toHaveProperty("currency");
    expect(result).not.toHaveProperty("otherCurrencies");
    expect(incomeAggregate.mock.calls[0][0].where).not.toHaveProperty(
      "currency",
    );
    expect(incomeCount.mock.calls[0][0].where).not.toHaveProperty("currency");
    expect(expenseAggregate.mock.calls[0][0].where).not.toHaveProperty(
      "currency",
    );
    expect(incomeGroupBy).not.toHaveBeenCalled();
    expect(expenseGroupBy).not.toHaveBeenCalled();
    expect(result.totalIncome).toBe(1000);
    expect(result.totalExpenses).toBe(400);
    expect(result.net).toBe(600);
  });

  it("filters income aggregate, count and expense aggregate by currency", async () => {
    const result = await service.getSummary("u1", "2026-04-08", "MXN");

    expect(incomeAggregate.mock.calls[0][0].where).toMatchObject({
      userId: "u1",
      currency: "MXN",
    });
    expect(incomeCount.mock.calls[0][0].where).toMatchObject({
      currency: "MXN",
    });
    expect(expenseAggregate.mock.calls[0][0].where).toMatchObject({
      userId: "u1",
      currency: "MXN",
    });
    expect(result).toMatchObject({
      currency: "MXN",
      totalIncome: 1000,
      totalExpenses: 400,
      net: 600,
      otherCurrencies: [],
    });
  });

  it("returns other currencies via groupBy without summing them", async () => {
    incomeGroupBy.mockResolvedValue([
      { currency: "USD", _sum: { amount: 50 } },
    ]);
    expenseGroupBy.mockResolvedValue([
      { currency: "USD", _sum: { cost: 20 } },
      { currency: "EUR", _sum: { cost: 7.555 } },
    ]);

    const result = await service.getSummary("u1", "2026-04-08", "MXN");

    expect(incomeGroupBy.mock.calls[0][0].by).toEqual(["currency"]);
    expect(incomeGroupBy.mock.calls[0][0].where).toMatchObject({
      currency: { not: "MXN" },
    });
    expect(expenseGroupBy.mock.calls[0][0].where).toMatchObject({
      currency: { not: "MXN" },
    });
    expect(result.totalIncome).toBe(1000);
    expect(result.totalExpenses).toBe(400);
    expect(result).toHaveProperty("otherCurrencies", [
      { currency: "EUR", totalIncome: 0, totalExpenses: 7.56 },
      { currency: "USD", totalIncome: 50, totalExpenses: 20 },
    ]);
  });
});
