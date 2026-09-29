import { CreditCardsService } from "./credit-cards.service";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateCreditCardDto } from "./dto/create-credit-card.dto";
import { UpdateCreditCardDto } from "./dto/update-credit-card.dto";

describe("CreditCardsService", () => {
  const creditCardFindMany = jest.fn();
  const expenseFindMany = jest.fn();
  const subscriptionFindMany = jest.fn();
  const statementImportFindMany = jest.fn();
  const entitlementsService = {
    assertPremium: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    creditCard: { findMany: creditCardFindMany },
    expense: { findMany: expenseFindMany },
    subscription: { findMany: subscriptionFindMany },
    statementImport: { findMany: statementImportFindMany },
  };

  let service: CreditCardsService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-08T10:00:00.000Z"));
    jest.resetAllMocks();
    entitlementsService.assertPremium.mockResolvedValue(undefined);
    creditCardFindMany.mockResolvedValue([card()]);
    expenseFindMany.mockResolvedValue([]);
    subscriptionFindMany.mockResolvedValue([]);
    statementImportFindMany.mockResolvedValue([]);
    service = new CreditCardsService(
      prisma as never,
      entitlementsService as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it("uses only the latest matching-currency statement balance", async () => {
    statementImportFindMany.mockResolvedValue([
      statement({
        closingBalance: 300,
        paidAmount: 100,
        periodEnd: "2026-03-31",
      }),
      statement({
        closingBalance: 900,
        paidAmount: 0,
        periodEnd: "2026-02-28",
      }),
    ]);

    const result = await service.getOverview("user-1", {});

    expect(result.cards[0].creditStatus).toMatchObject({
      owedBalance: 200,
      availableCredit: 800,
      utilizationPercent: 20,
    });
    expect(result.cards[0].statementSummary).toMatchObject({
      closingBalance: 300,
      paidTotal: 100,
      remainingStatement: 200,
      projectedTotalDebt: 200,
    });
  });

  it("excludes pre-close unlinked expenses and includes post-close expenses", async () => {
    statementImportFindMany.mockResolvedValue([
      statement({
        closingBalance: 300,
        paidAmount: 100,
        periodEnd: "2026-03-31",
      }),
    ]);
    mockExpenseQueries(
      [],
      [
        expense({ cost: 50, date: "2026-03-30T12:00:00.000Z" }),
        expense({ cost: 75, date: "2026-04-01T00:00:00.000Z" }),
      ],
    );

    const result = await service.getOverview("user-1", {});

    expect(result.cards[0].creditStatus.owedBalance).toBe(275);
    expect(result.cards[0].statementSummary).toMatchObject({
      postCloseSpend: 75,
      postCloseExpenseCount: 1,
      projectedNextCloseAmount: 75,
      projectedTotalDebt: 275,
    });
  });

  it("uses a strict UTC day-end boundary for post-close spend", async () => {
    statementImportFindMany.mockResolvedValue([
      statement({ closingBalance: 300, periodEnd: "2026-03-31" }),
    ]);
    mockExpenseQueries(
      [],
      [
        expense({ cost: 50, date: "2026-03-31T23:59:59.999Z" }),
        expense({ cost: 75, date: "2026-04-01T00:00:00.000Z" }),
      ],
    );

    const result = await service.getOverview("user-1", {});

    expect(result.cards[0].statementSummary).toMatchObject({
      postCloseSpend: 75,
      postCloseExpenseCount: 1,
    });
  });

  it("excludes future-dated unlinked spend from projections", async () => {
    statementImportFindMany.mockResolvedValue([
      statement({ closingBalance: 300, periodEnd: "2026-03-31" }),
    ]);
    mockExpenseQueries(
      [],
      [
        expense({ cost: 75, date: "2026-04-01T00:00:00.000Z" }),
        expense({ cost: 500, date: "2026-04-09T00:00:00.000Z" }),
      ],
    );

    const result = await service.getOverview("user-1", {});

    expect(result.cards[0].statementSummary.projectedNextCloseAmount).toBe(75);
  });

  it("uses every eligible unlinked expense when no confirmed statement exists", async () => {
    mockExpenseQueries(
      [],
      [
        expense({ cost: 50, date: "2026-01-01T12:00:00.000Z" }),
        expense({ cost: 75, date: "2026-04-01T00:00:00.000Z" }),
      ],
    );

    const result = await service.getOverview("user-1", {});

    expect(result.cards[0].creditStatus.owedBalance).toBe(125);
    expect(result.cards[0].statementSummary.projectedNextCloseAmount).toBe(125);
  });

  it("excludes currency mismatches from card money and exposes a warning count", async () => {
    statementImportFindMany.mockResolvedValue([
      statement({
        currency: "USD",
        closingBalance: 500,
        periodEnd: "2026-03-31",
      }),
    ]);
    mockExpenseQueries(
      [
        expense({
          cost: 20,
          currency: "USD",
          date: "2026-04-02T00:00:00.000Z",
        }),
      ],
      [
        expense({
          cost: 30,
          currency: "USD",
          date: "2026-04-02T00:00:00.000Z",
        }),
      ],
    );
    subscriptionFindMany.mockResolvedValue([
      subscription({ cost: 40, currency: "USD" }),
    ]);

    const result = await service.getOverview("user-1", {});

    expect(result.cards[0]).toMatchObject({
      currentCycle: { spend: 0, expenseCount: 0, currencyMismatchCount: 1 },
      creditStatus: { owedBalance: 0, availableCredit: 1000 },
      subscriptions: { monthlyRecurringSpend: 0, currencyMismatchCount: 1 },
      flags: { currencyMismatch: true },
    });
    expect(result.cards[0].currencyMismatchCount).toBeGreaterThan(0);
  });

  it("counts one mismatched unlinked expense once across overlapping queries", async () => {
    const mismatchedExpense = expense({
      id: "overlapping-expense",
      cost: 20,
      currency: "USD",
      date: "2026-04-02T00:00:00.000Z",
    });
    mockExpenseQueries([mismatchedExpense], [mismatchedExpense]);

    const result = await service.getOverview("user-1", {});

    expect(result.cards[0].currencyMismatchCount).toBe(1);
    expect(result.cards[0]).not.toHaveProperty("expenseIds");
  });

  it("ignores a foreign-currency target and falls back to closing balance", async () => {
    statementImportFindMany.mockResolvedValue([
      statement({
        closingBalance: 300,
        periodEnd: "2026-03-31",
        paymentTargetCurrency: "USD",
      }),
    ]);

    const result = await service.getOverview("user-1", {});

    expect(result.cards[0].nextPayment).toMatchObject({
      amount: 300,
      currency: "MXN",
    });
    expect(result.cards[0].flags.currencyMismatch).toBe(true);
  });

  it("keeps portfolio monetary totals separate by currency", async () => {
    creditCardFindMany.mockResolvedValue([
      card({ id: "mxn-card", currency: "MXN", creditLimit: 1000 }),
      card({ id: "usd-card", currency: "USD", creditLimit: 500 }),
    ]);
    mockExpenseQueries(
      [
        expense({ creditCardId: "mxn-card", cost: 100, currency: "MXN" }),
        expense({ creditCardId: "usd-card", cost: 50, currency: "USD" }),
      ],
      [
        expense({ creditCardId: "mxn-card", cost: 100, currency: "MXN" }),
        expense({ creditCardId: "usd-card", cost: 50, currency: "USD" }),
      ],
    );

    const result = await service.getOverview("user-1", {});

    expect(result.portfolio.byCurrency).toEqual([
      expect.objectContaining({
        currency: "MXN",
        totalCreditLimit: 1000,
        totalOwedBalance: 100,
        totalCurrentCycleSpend: 100,
      }),
      expect.objectContaining({
        currency: "USD",
        totalCreditLimit: 500,
        totalOwedBalance: 50,
        totalCurrentCycleSpend: 50,
      }),
    ]);
    expect(result.portfolio).not.toHaveProperty("totalCreditLimit");
  });

  it("keeps partially paid statement debt even when paid status is true", async () => {
    statementImportFindMany.mockResolvedValue([
      statement({
        closingBalance: 4199.31,
        paidAmount: 2000,
        periodEnd: "2026-03-31",
      }),
    ]);

    const result = await service.getOverview("user-1", {});

    expect(result.cards[0].creditStatus.owedBalance).toBe(2199.31);
  });

  it("subtracts active payments from the current no-interest payment due", async () => {
    statementImportFindMany.mockResolvedValue([
      statement({
        closingBalance: 500,
        paidAmount: 125,
        periodEnd: "2026-03-31",
        paymentTargetCurrency: "MXN",
        paymentTargetAmount: 300,
      }),
    ]);

    const result = await service.getOverview("user-1", {});

    expect(result.cards[0].statementSummary.currentPaymentDue).toBe(175);
    expect(result.cards[0].nextPayment?.amount).toBe(175);
  });

  it("falls back to closing balance for the current payment due", async () => {
    statementImportFindMany.mockResolvedValue([
      statement({
        closingBalance: 500,
        paidAmount: 125,
        periodEnd: "2026-03-31",
      }),
    ]);

    const result = await service.getOverview("user-1", {});

    expect(result.cards[0].statementSummary.currentPaymentDue).toBe(375);
    expect(result.cards[0].nextPayment?.amount).toBe(375);
  });

  it("returns the configured currency from create writes", async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ id: "card-1", currency: "USD" });
    const writeService = new CreditCardsService(
      { creditCard: { create } } as never,
      entitlementsService as never,
    );

    await writeService.create("user-1", {
      name: "Travel",
      bank: "Bank",
      brand: "VISA",
      last4: "4242",
      currency: "USD",
    });

    const createCalls = create.mock.calls as Array<
      [{ data: { currency: string } }]
    >;
    const createCall = createCalls[0][0];
    expect(createCall.data.currency).toBe("USD");
  });

  it("normalizes valid card currency and rejects invalid codes", async () => {
    const valid = plainToInstance(CreateCreditCardDto, {
      name: "Travel",
      bank: "Bank",
      brand: "VISA",
      last4: "4242",
      currency: " usd ",
    });
    const invalid = plainToInstance(CreateCreditCardDto, {
      name: "Travel",
      bank: "Bank",
      brand: "VISA",
      last4: "4242",
      currency: "US",
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.currency).toBe("USD");
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it("does not default currency on a partial update", () => {
    const update = plainToInstance(UpdateCreditCardDto, { name: "Updated" });

    expect(update.currency).toBeUndefined();
  });

  function mockExpenseQueries(cycleRows: unknown[], unlinkedRows: unknown[]) {
    expenseFindMany.mockImplementation(
      (args: { where: { statementRowId?: null } }) =>
        Promise.resolve(
          "statementRowId" in args.where ? unlinkedRows : cycleRows,
        ),
    );
  }

  function card(
    overrides: Partial<{
      id: string;
      currency: string;
      creditLimit: number;
    }> = {},
  ) {
    return {
      id: overrides.id ?? "card-1",
      name: "Rewards",
      bank: "Bank",
      brand: "VISA",
      last4: "4242",
      color: "#7C3AED",
      creditLimit: overrides.creditLimit ?? 1000,
      closingDay: 15,
      paymentDueDay: 25,
      currency: overrides.currency ?? "MXN",
      isActive: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    };
  }

  function expense(
    overrides: Partial<{
      id: string;
      creditCardId: string;
      cost: number;
      currency: string;
      date: string;
    }> = {},
  ) {
    return {
      id: overrides.id ?? "expense-1",
      creditCardId: overrides.creditCardId ?? "card-1",
      cost: overrides.cost ?? 100,
      currency: overrides.currency ?? "MXN",
      date: new Date(overrides.date ?? "2026-04-02T00:00:00.000Z"),
    };
  }

  function subscription(
    overrides: Partial<{ cost: number; currency: string }> = {},
  ) {
    return {
      id: "subscription-1",
      creditCardId: "card-1",
      cost: overrides.cost ?? 100,
      currency: overrides.currency ?? "MXN",
      billingCycle: "MONTHLY",
      nextPaymentDate: new Date("2026-04-10T00:00:00.000Z"),
      isActive: true,
    };
  }

  function statement(options: {
    currency?: string;
    closingBalance: number;
    paidAmount?: number | null;
    periodEnd: string;
    paymentTargetCurrency?: string;
    paymentTargetAmount?: number;
  }) {
    return {
      id: `statement-${options.periodEnd}`,
      creditCardId: "card-1",
      periodStart: new Date(`${options.periodEnd.slice(0, 8)}01T12:00:00.000Z`),
      periodEnd: new Date(`${options.periodEnd}T12:00:00.000Z`),
      createdAt: new Date(`${options.periodEnd}T13:00:00.000Z`),
      reconciliation: {
        closingBalance: options.closingBalance,
        currency: options.currency ?? "MXN",
        status: "PASSED",
      },
      paymentTargets: options.paymentTargetCurrency
        ? [
            {
              kind: "NO_INTEREST",
              amount: options.paymentTargetAmount ?? options.closingBalance,
              currency: options.paymentTargetCurrency,
              dueDate: new Date("2026-04-25T12:00:00.000Z"),
              position: 0,
            },
          ]
        : [],
      payments:
        options.paidAmount && options.paidAmount > 0
          ? [
              {
                amount: options.paidAmount,
                currency: options.currency ?? "MXN",
                voidedAt: null,
              },
            ]
          : [],
    };
  }
});
