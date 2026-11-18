import { ExpensesService } from "./expenses.service";
describe("ExpensesService transaction creation", () => {
  const root = {
    expense: { create: jest.fn() },
    category: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const tx = {
    expense: { create: jest.fn() },
    category: { findFirst: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  const cards = { resolveLinkedCreditCardId: jest.fn() };
  const entitlements = { assertPremium: jest.fn() };
  const service = new ExpensesService(
    root as never,
    {} as never,
    cards as never,
    entitlements as never,
    {} as never,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    cards.resolveLinkedCreditCardId.mockResolvedValue(null);
    tx.expense.create.mockImplementation(({ data }: { data: unknown }) =>
      Promise.resolve({
        id: "expense",
        ...(data as object),
      }),
    );
    tx.category.findFirst.mockResolvedValue({ id: "category" });
  });
  it("uses the supplied client for category creation and the single expense", async () => {
    tx.category.findFirst.mockResolvedValue(null);
    tx.category.create.mockResolvedValue({ id: "new-category" });
    await service.createInTransaction(
      "owner",
      { title: "Coffee", cost: 2, currency: "MXN", categoryName: "Food" },
      tx as never,
    );
    expect(tx.category.create).toHaveBeenCalled();
    expect(tx.expense.create).toHaveBeenCalledTimes(1);
    expect(root.category.create).not.toHaveBeenCalled();
    expect(root.expense.create).not.toHaveBeenCalled();
    expect(root.$transaction).not.toHaveBeenCalled();
    expect(cards.resolveLinkedCreditCardId).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner", tx }),
    );
  });
  it("creates every installment on the supplied transaction without nesting", async () => {
    await service.createInTransaction(
      "owner",
      {
        title: "Laptop",
        cost: 30,
        currency: "MXN",
        categoryId: "category",
        isInstallment: true,
        installmentCount: 3,
        installmentFirstPaymentDate: "2026-11-01T00:00:00Z",
      },
      tx as never,
    );
    expect(tx.expense.create).toHaveBeenCalledTimes(3);
    expect(root.expense.create).not.toHaveBeenCalled();
    expect(root.$transaction).not.toHaveBeenCalled();
    expect(entitlements.assertPremium).toHaveBeenCalledWith(
      "owner",
      "installment_expenses",
    );
  });
  it("validates category ownership in the same transaction", async () => {
    tx.category.findFirst.mockResolvedValue(null);
    await expect(
      service.createInTransaction(
        "owner",
        { title: "Coffee", cost: 1, categoryId: "other-category" },
        tx as never,
      ),
    ).rejects.toThrow("Category not found");
    expect(tx.category.findFirst).toHaveBeenCalledWith({
      where: { id: "other-category", userId: "owner" },
      select: { id: true },
    });
    expect(tx.expense.create).not.toHaveBeenCalled();
  });
});
