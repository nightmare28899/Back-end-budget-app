import { UsersService } from "./users.service";

describe("UsersService.deletePermanently", () => {
  const callOrder: string[] = [];
  const track = (name: string) =>
    jest.fn(() => {
      callOrder.push(name);
      return Promise.resolve({ count: 0 });
    });
  const tx = {
    authSession: { deleteMany: track("authSession.deleteMany") },
    deviceToken: { deleteMany: track("deviceToken.deleteMany") },
    reportHistory: { deleteMany: track("reportHistory.deleteMany") },
    expense: { deleteMany: track("expense.deleteMany") },
    income: { deleteMany: track("income.deleteMany") },
    subscription: { deleteMany: track("subscription.deleteMany") },
    statementPayment: {
      updateMany: track("statementPayment.updateMany"),
      deleteMany: track("statementPayment.deleteMany"),
    },
    statementImport: { deleteMany: track("statementImport.deleteMany") },
    creditCard: { deleteMany: track("creditCard.deleteMany") },
    category: { deleteMany: track("category.deleteMany") },
    savingsTransaction: { deleteMany: track("savingsTransaction.deleteMany") },
    savingsGoal: { deleteMany: track("savingsGoal.deleteMany") },
    user: { delete: track("user.delete") },
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const storage = { deleteFile: jest.fn() };
  let service: UsersService;

  beforeEach(() => {
    callOrder.length = 0;
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      avatarUrl: null,
      expenses: [],
      savingsGoals: [],
    });
    service = new UsersService(prisma as never, storage as never);
  });

  it("removes the payment ledger and statement imports before cards, categories and the user", async () => {
    await service.deletePermanently("user-1", {
      id: "user-1",
      role: "user",
    } as never);

    expect(tx.statementPayment.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", supersedesId: { not: null } },
      data: { supersedesId: null },
    });
    expect(tx.statementPayment.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(tx.statementImport.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });

    const at = (name: string) => callOrder.indexOf(name);
    expect(at("expense.deleteMany")).toBeLessThan(
      at("statementPayment.updateMany"),
    );
    expect(at("statementPayment.updateMany")).toBeLessThan(
      at("statementPayment.deleteMany"),
    );
    expect(at("statementPayment.deleteMany")).toBeLessThan(
      at("statementImport.deleteMany"),
    );
    expect(at("statementImport.deleteMany")).toBeLessThan(
      at("creditCard.deleteMany"),
    );
    expect(at("statementImport.deleteMany")).toBeLessThan(
      at("category.deleteMany"),
    );
    expect(at("category.deleteMany")).toBeLessThan(at("user.delete"));
  });
});
