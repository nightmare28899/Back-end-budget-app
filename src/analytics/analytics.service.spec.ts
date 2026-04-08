import { BadRequestException } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { formatDateOnly } from "../common/budget/budget.utils";

describe("AnalyticsService", () => {
  type DailyTotalsWhere = {
    where: {
      date: {
        gte: Date;
        lte: Date;
      };
    };
  };

  type ExpenseRow = {
    cost: number;
    date: Date;
  };

  const findMany = jest.fn<Promise<ExpenseRow[]>, [DailyTotalsWhere]>();
  const prisma = {
    expense: {
      findMany,
    },
  };

  let service: AnalyticsService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 3, 7, 10, 0, 0, 0));
    findMany.mockReset();
    service = new AnalyticsService(prisma as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("builds the daily totals window up to the requested anchor date", async () => {
    findMany.mockResolvedValue([
      { cost: 120, date: new Date(2026, 3, 5, 9, 0, 0, 0) },
      { cost: 80, date: new Date(2026, 3, 7, 11, 0, 0, 0) },
    ]);

    const result = await service.getDailyTotals("user-1", 3, "2026-04-07");

    const [{ where }] = findMany.mock.calls[0];
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
});
