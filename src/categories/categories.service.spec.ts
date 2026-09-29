import { NotFoundException } from "@nestjs/common";
import { CategoriesService } from "./categories.service";

describe("CategoriesService", () => {
  const categoryFindMany = jest.fn();
  const categoryFindFirst = jest.fn();
  const categoryDelete = jest.fn();
  const prisma = {
    category: {
      findMany: categoryFindMany,
      findFirst: categoryFindFirst,
      delete: categoryDelete,
    },
  };

  let service: CategoriesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CategoriesService(prisma as never);
  });

  it("maps usage counts while preserving every owned category", async () => {
    categoryFindMany.mockResolvedValue([
      {
        id: "category-1",
        userId: "user-1",
        name: "Food",
        icon: "🍔",
        color: "#FF6B6B",
        budgetAmount: null,
        _count: { expenses: 2, subscriptions: 1, statementRows: 3 },
      },
      {
        id: "category-2",
        userId: "user-1",
        name: "Health",
        icon: "💊",
        color: "#FFEAA7",
        budgetAmount: 500,
        _count: { expenses: 0, subscriptions: 0, statementRows: 0 },
      },
    ]);

    await expect(service.findAll("user-1")).resolves.toEqual([
      {
        id: "category-1",
        userId: "user-1",
        name: "Food",
        icon: "🍔",
        color: "#FF6B6B",
        budgetAmount: null,
        usage: {
          expenseCount: 2,
          subscriptionCount: 1,
          statementRowCount: 3,
        },
      },
      {
        id: "category-2",
        userId: "user-1",
        name: "Health",
        icon: "💊",
        color: "#FFEAA7",
        budgetAmount: 500,
        usage: {
          expenseCount: 0,
          subscriptionCount: 0,
          statementRowCount: 0,
        },
      },
    ]);
    expect(categoryFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      include: {
        _count: {
          select: {
            expenses: true,
            subscriptions: true,
            statementRows: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });
  });

  it("deletes an unused owned category", async () => {
    categoryFindFirst.mockResolvedValue({
      id: "category-1",
      _count: { expenses: 0, subscriptions: 0, statementRows: 0 },
    });
    categoryDelete.mockResolvedValue({ id: "category-1" });

    await expect(service.remove("category-1", "user-1")).resolves.toEqual({
      id: "category-1",
    });
    expect(categoryDelete).toHaveBeenCalledWith({
      where: { id: "category-1" },
    });
  });

  it.each([
    ["expense", { expenses: 1, subscriptions: 0, statementRows: 0 }],
    ["subscription", { expenses: 0, subscriptions: 1, statementRows: 0 }],
    ["statement row", { expenses: 0, subscriptions: 0, statementRows: 1 }],
  ])("blocks deletion when the category has a linked %s", async (_, counts) => {
    categoryFindFirst.mockResolvedValue({ id: "category-1", _count: counts });

    await expect(service.remove("category-1", "user-1")).rejects.toMatchObject({
      status: 409,
      response: {
        code: "CATEGORY_IN_USE",
        message: "categoryDeleteBlocked",
      },
    });
    expect(categoryDelete).not.toHaveBeenCalled();
  });

  it("maps a P2003 delete race to the same conflict", async () => {
    categoryFindFirst.mockResolvedValue({
      id: "category-1",
      _count: { expenses: 0, subscriptions: 0, statementRows: 0 },
    });
    categoryDelete.mockRejectedValue(
      Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" }),
    );

    await expect(service.remove("category-1", "user-1")).rejects.toMatchObject({
      status: 409,
      response: {
        code: "CATEGORY_IN_USE",
        message: "categoryDeleteBlocked",
      },
    });
  });

  it("keeps missing or not-owned categories as not found", async () => {
    categoryFindFirst.mockResolvedValue(null);

    await expect(service.remove("category-1", "user-2")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(categoryFindFirst).toHaveBeenCalledWith({
      where: { id: "category-1", userId: "user-2" },
      select: {
        id: true,
        _count: {
          select: {
            expenses: true,
            subscriptions: true,
            statementRows: true,
          },
        },
      },
    });
    expect(categoryDelete).not.toHaveBeenCalled();
  });
});
