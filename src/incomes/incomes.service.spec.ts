import { Prisma } from "@prisma/client";
import { IncomesService } from "./incomes.service";

type FindManyArgs = {
  where: Prisma.IncomeWhereInput;
  take?: number;
};
type WhereArgs = { where: Prisma.IncomeWhereInput };

describe("IncomesService.findAll", () => {
  const findMany = jest.fn<Promise<unknown>, [FindManyArgs]>();
  const count = jest.fn<Promise<unknown>, [WhereArgs]>();
  const aggregate = jest.fn<Promise<unknown>, [WhereArgs]>();
  const groupBy = jest.fn<Promise<unknown>, [WhereArgs]>();
  const prisma = { income: { findMany, count, aggregate, groupBy } };
  let service: IncomesService;

  const rows = [{ id: "a" }, { id: "b" }];

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue(rows);
    count.mockResolvedValue(45);
    aggregate.mockResolvedValue({ _sum: { amount: 100.456 } });
    groupBy.mockResolvedValue([
      { currency: "MXN", _sum: { amount: 60.126 } },
      { currency: "USD", _sum: { amount: 40.33 } },
    ]);
    service = new IncomesService(prisma as never);
  });

  it("keeps the legacy shape and query when page is absent", async () => {
    const result = await service.findAll("u1", {});

    expect(result).toEqual({
      incomes: rows,
      total: 100.46,
      count: 2,
      currencyBreakdown: [
        { currency: "MXN", total: 60.13 },
        { currency: "USD", total: 40.33 },
      ],
    });
    expect(result).not.toHaveProperty("pagination");
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      orderBy: { date: "desc" },
    });
    expect(count).not.toHaveBeenCalled();
  });

  it("ignores limit alone (legacy mode)", async () => {
    const result = await service.findAll("u1", { limit: 5 });

    expect(result).not.toHaveProperty("pagination");
    expect(findMany.mock.calls[0][0]).not.toHaveProperty("take");
  });

  it("returns the paged envelope with stable ordering", async () => {
    const result = await service.findAll("u1", { page: 2, limit: 20 });

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: 20,
      take: 20,
    });
    expect(result).toEqual({
      incomes: rows,
      total: 100.46,
      count: 2,
      currencyBreakdown: [
        { currency: "MXN", total: 60.13 },
        { currency: "USD", total: 40.33 },
      ],
      pagination: {
        page: 2,
        limit: 20,
        totalCount: 45,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      },
    });
  });

  it("defaults limit to 20 and reports last page", async () => {
    const result = await service.findAll("u1", { page: 3 });

    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 40, take: 20 });
    expect(result).toMatchObject({
      pagination: { hasNext: false, hasPrev: true, totalPages: 3 },
    });
  });

  it("applies the same where to count, aggregate and groupBy", async () => {
    await service.findAll("u1", { page: 1, q: " salary " });

    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(2);
    expect(count.mock.calls[0][0].where).toEqual(where);
    expect(aggregate.mock.calls[0][0].where).toEqual(where);
    expect(groupBy.mock.calls[0][0].where).toEqual(where);
  });
});
