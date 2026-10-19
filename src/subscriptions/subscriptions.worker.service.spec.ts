import { BillingCycle, PaymentMethod, Prisma } from "@prisma/client";
import type { Subscription } from "@prisma/client";
import type { NotificationsService } from "../notifications/notifications.service";
import type { PrismaService } from "../prisma/prisma.service";
import { SubscriptionsWorkerService } from "./subscriptions.worker.service";

type SubscriptionSnapshot = Pick<
  Subscription,
  | "id"
  | "userId"
  | "isActive"
  | "updatedAt"
  | "name"
  | "cost"
  | "currency"
  | "paymentMethod"
  | "creditCardId"
  | "categoryId"
  | "nextPaymentDate"
  | "billingCycle"
>;

const now = new Date(2026, 8, 1, 12);
const nextMonth = new Date(2026, 9, 1, 12);

function subscriptionFixture(): SubscriptionSnapshot {
  return {
    id: "subscription-1",
    userId: "user-1",
    isActive: true,
    updatedAt: new Date(2026, 7, 1, 12),
    name: "Music",
    cost: new Prisma.Decimal("149.50"),
    currency: "MXN",
    paymentMethod: PaymentMethod.CREDIT_CARD,
    creditCardId: "card-1",
    categoryId: "category-1",
    nextPaymentDate: new Date(now),
    billingCycle: BillingCycle.MONTHLY,
  };
}

function expectedExpense(date: Date) {
  const subscription = subscriptionFixture();
  return {
    userId: subscription.userId,
    title: "Music subscription",
    cost: subscription.cost,
    currency: subscription.currency,
    paymentMethod: subscription.paymentMethod,
    creditCardId: subscription.creditCardId,
    categoryId: subscription.categoryId,
    date,
    note: "Auto-generated from subscription Music",
    isSubscription: true,
    subscriptionId: subscription.id,
  };
}

function sameScalar(actual: unknown, expected: unknown): boolean {
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  if (actual instanceof Prisma.Decimal && expected instanceof Prisma.Decimal) {
    return actual.equals(expected);
  }
  return actual === expected;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

describe("SubscriptionsWorkerService.processDueSubscriptions", () => {
  const findMany = jest.fn<
    Promise<SubscriptionSnapshot[]>,
    [Prisma.SubscriptionFindManyArgs]
  >();
  const updateMany = jest.fn<
    Promise<Prisma.BatchPayload>,
    [Prisma.SubscriptionUpdateManyArgs]
  >();
  const update = jest.fn<
    Promise<SubscriptionSnapshot>,
    [Prisma.SubscriptionUpdateArgs]
  >();
  const createMany = jest.fn<
    Promise<Prisma.BatchPayload>,
    [Prisma.ExpenseCreateManyArgs]
  >();
  const tx = {
    subscription: { updateMany, update },
    expense: { createMany },
  };
  const transaction = jest.fn<
    Promise<unknown>,
    [(client: typeof tx) => Promise<unknown>]
  >();
  const prisma = { subscription: { findMany }, $transaction: transaction };

  let service: SubscriptionsWorkerService;
  let row: SubscriptionSnapshot;
  let expenses: Prisma.ExpenseCreateManyInput[];
  let operations: string[];

  function advanceRow(data: Prisma.SubscriptionUpdateManyMutationInput) {
    if (!(data.nextPaymentDate instanceof Date)) {
      throw new Error("The fake only supports advancing to a Date");
    }
    row = {
      ...row,
      nextPaymentDate: new Date(data.nextPaymentDate),
      updatedAt: new Date(row.updatedAt.getTime() + 1),
    };
  }

  beforeEach(() => {
    jest.resetAllMocks();
    row = subscriptionFixture();
    expenses = [];
    operations = [];
    findMany.mockImplementation(({ where }) => {
      operations.push("fetch");
      const dateFilter = where?.nextPaymentDate;
      if (
        !dateFilter ||
        typeof dateFilter !== "object" ||
        dateFilter instanceof Date ||
        !(dateFilter.lte instanceof Date)
      ) {
        throw new Error("The fake expects an inclusive due-date filter");
      }
      return Promise.resolve(
        row.isActive &&
          row.nextPaymentDate <= dateFilter.lte &&
          (!where?.userId || row.userId === where.userId)
          ? [{ ...row }]
          : [],
      );
    });
    updateMany.mockImplementation(({ where, data }) => {
      operations.push("claim");
      const matches = Object.entries(where ?? {}).every(([key, value]) =>
        sameScalar(row[key as keyof SubscriptionSnapshot], value),
      );
      if (matches) advanceRow(data);
      return Promise.resolve({ count: matches ? 1 : 0 });
    });
    update.mockImplementation(({ data }) => {
      operations.push("unconditional-update");
      advanceRow(data);
      return Promise.resolve({ ...row });
    });
    createMany.mockImplementation(({ data }) => {
      operations.push("expenses");
      const created = Array.isArray(data) ? data : [data];
      expenses.push(...created);
      return Promise.resolve({ count: created.length });
    });

    // This fake models scalar matching and rollback with serialized callbacks,
    // not PostgreSQL row locking or isolation semantics.
    let transactionQueue = Promise.resolve();
    transaction.mockImplementation((callback) => {
      const result = transactionQueue.then(async () => {
        operations.push("transaction");
        const originalRow = { ...row };
        const originalExpenseCount = expenses.length;
        try {
          return await callback(tx);
        } catch (error) {
          row = originalRow;
          expenses.splice(originalExpenseCount);
          throw error;
        }
      });
      transactionQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    });
    service = new SubscriptionsWorkerService(
      prisma as unknown as PrismaService,
      {} as NotificationsService,
    );
  });

  it("claims the owned active snapshot before creating the unchanged expense and result", async () => {
    await expect(
      service.processDueSubscriptions(now, "user-1"),
    ).resolves.toEqual({
      processedCount: 1,
      results: [
        {
          subscriptionId: "subscription-1",
          name: "Music",
          expensesCreated: 1,
          nextPaymentDate: nextMonth,
        },
      ],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        nextPaymentDate: { lte: now },
        userId: "user-1",
      },
      orderBy: { nextPaymentDate: "asc" },
      select: Object.fromEntries(
        Object.keys(subscriptionFixture()).map((key) => [key, true]),
      ),
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: subscriptionFixture(),
      data: { nextPaymentDate: nextMonth },
    });
    expect(createMany).toHaveBeenCalledWith({ data: [expectedExpense(now)] });
    expect(expenses).toEqual([expectedExpense(now)]);
    expect(row.nextPaymentDate).toEqual(nextMonth);
    expect(operations).toEqual(["fetch", "transaction", "claim", "expenses"]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("materializes and reports only one winner when two calls fetch the same snapshot", async () => {
    const bothFetched = deferred();
    const snapshots: SubscriptionSnapshot[] = [];
    findMany.mockImplementation(() => {
      const snapshot = { ...row };
      snapshots.push(snapshot);
      if (snapshots.length === 2) bothFetched.resolve();
      return bothFetched.promise.then(() => [snapshot]);
    });

    const results = await Promise.all([
      service.processDueSubscriptions(now),
      service.processDueSubscriptions(now, "user-1"),
    ]);

    expect(snapshots).toEqual([subscriptionFixture(), subscriptionFixture()]);
    expect(results.map((result) => result.processedCount).sort()).toEqual([
      0, 1,
    ]);
    expect(results.flatMap((result) => result.results)).toEqual([
      {
        subscriptionId: "subscription-1",
        name: "Music",
        expensesCreated: 1,
        nextPaymentDate: nextMonth,
      },
    ]);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(expenses).toEqual([expectedExpense(now)]);
    expect(row.nextPaymentDate).toEqual(nextMonth);
  });

  it.each<[string, Partial<SubscriptionSnapshot>]>([
    ["due date", { nextPaymentDate: nextMonth }],
    ["version", { updatedAt: new Date(2026, 7, 2, 12) }],
    ["deactivation", { isActive: false }],
    ["owner", { userId: "user-2" }],
    ["name", { name: "Video" }],
    ["cost", { cost: new Prisma.Decimal("199.00") }],
    ["currency", { currency: "USD" }],
    ["payment method", { paymentMethod: PaymentMethod.CASH }],
    ["credit card", { creditCardId: null }],
    ["category", { categoryId: null }],
    ["billing cycle", { billingCycle: BillingCycle.YEARLY }],
  ])(
    "skips a stale %s without creating expenses or advancing the current row",
    async (_, changes) => {
      const snapshot = { ...row };
      findMany.mockImplementationOnce(() => {
        // Keep updatedAt unchanged in scalar-edit cases to test each guard.
        row = { ...row, ...changes };
        return Promise.resolve([snapshot]);
      });

      await expect(service.processDueSubscriptions(now)).resolves.toEqual({
        processedCount: 0,
        results: [],
      });
      expect(row).toEqual({ ...snapshot, ...changes });
      expect(createMany).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(expenses).toEqual([]);
      expect(operations).toEqual(["transaction", "claim"]);
    },
  );

  it("creates no duplicates on a sequential rerun", async () => {
    await service.processDueSubscriptions(now);
    await expect(service.processDueSubscriptions(now)).resolves.toEqual({
      processedCount: 0,
      results: [],
    });
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(expenses).toEqual([expectedExpense(now)]);
  });

  it("preserves nullable relationships for cash expenses", async () => {
    row = {
      ...row,
      paymentMethod: PaymentMethod.CASH,
      creditCardId: null,
      categoryId: null,
    };
    await service.processDueSubscriptions(now);
    expect(expenses).toEqual([
      {
        ...expectedExpense(now),
        paymentMethod: PaymentMethod.CASH,
        creditCardId: null,
        categoryId: null,
      },
    ]);
    expect(updateMany.mock.calls[0][0].where).toMatchObject({
      creditCardId: null,
      categoryId: null,
    });
  });

  it.each([
    {
      cycle: BillingCycle.DAILY,
      dates: [29, 30, 31].map((day) => new Date(2026, 7, day, 12)).concat(now),
      next: new Date(2026, 8, 2, 12),
    },
    {
      cycle: BillingCycle.WEEKLY,
      dates: [11, 18, 25].map((day) => new Date(2026, 7, day, 12)).concat(now),
      next: new Date(2026, 8, 8, 12),
    },
    {
      cycle: BillingCycle.MONTHLY,
      dates: [5, 6, 7, 8].map((month) => new Date(2026, month, 1, 12)),
      next: nextMonth,
    },
    {
      cycle: BillingCycle.YEARLY,
      dates: [2024, 2025, 2026].map((year) => new Date(year, 8, 1, 12)),
      next: new Date(2027, 8, 1, 12),
    },
  ])(
    "preserves all inclusive $cycle catch-up dates and the next date",
    async ({ cycle, dates, next }) => {
      row = { ...row, billingCycle: cycle, nextPaymentDate: dates[0] };
      const result = await service.processDueSubscriptions(now);
      expect(expenses).toEqual(dates.map(expectedExpense));
      expect(row.nextPaymentDate).toEqual(next);
      expect(result.results[0]).toMatchObject({
        expensesCreated: dates.length,
        nextPaymentDate: next,
      });
    },
  );

  it.each([
    {
      scenario: "month-end overflow",
      cycle: BillingCycle.MONTHLY,
      dates: [new Date(2026, 0, 31, 12), new Date(2026, 2, 3, 12)],
      next: new Date(2026, 3, 3, 12),
    },
    {
      scenario: "leap-day overflow",
      cycle: BillingCycle.YEARLY,
      dates: [new Date(2024, 1, 29, 12), new Date(2025, 2, 1, 12)],
      next: new Date(2026, 2, 1, 12),
    },
  ])(
    "preserves existing $scenario calendar behavior",
    async ({ cycle, dates, next }) => {
      row = { ...row, billingCycle: cycle, nextPaymentDate: dates[0] };
      await service.processDueSubscriptions(dates[1]);
      expect(expenses).toEqual(dates.map(expectedExpense));
      expect(row.nextPaymentDate).toEqual(next);
    },
  );

  it("rolls back a claimed date on expense failure and allows a retry", async () => {
    const failure = new Error("Expense insertion failed");
    createMany.mockImplementationOnce(() => {
      expect(row.nextPaymentDate).toEqual(nextMonth);
      return Promise.reject(failure);
    });

    await expect(service.processDueSubscriptions(now)).rejects.toBe(failure);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(row).toEqual(subscriptionFixture());
    expect(expenses).toEqual([]);

    await expect(service.processDueSubscriptions(now)).resolves.toMatchObject({
      processedCount: 1,
    });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(expenses).toEqual([expectedExpense(now)]);
    expect(row.nextPaymentDate).toEqual(nextMonth);
  });
});
