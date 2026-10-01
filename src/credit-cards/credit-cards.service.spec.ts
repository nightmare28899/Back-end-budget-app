import { CreditCardsService } from "./credit-cards.service";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateCreditCardDto } from "./dto/create-credit-card.dto";
import { UpdateCreditCardDto } from "./dto/update-credit-card.dto";
import { splitAmountAcrossInstallments } from "../expenses/installments/expense-installments.util";

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

  it("never projects less debt than the current payment due", async () => {
    statementImportFindMany.mockResolvedValue([
      statement({
        closingBalance: 4199.31,
        paidAmount: 4199.31,
        periodEnd: "2026-03-31",
        paymentTargetCurrency: "MXN",
        paymentTargetAmount: 10651.6,
      }),
    ]);

    const result = await service.getOverview("user-1", {});
    const [card] = result.cards;

    expect(card.statementSummary.currentPaymentDue).toBe(6452.29);
    expect(card.statementSummary.remainingStatement).toBe(6452.29);
    expect(card.creditStatus.owedBalance).toBe(6452.29);
    expect(card.statementSummary.projectedTotalDebt).toBe(6452.29);
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

  it("adds deferred installment balances to the debt of a fully paid statement", async () => {
    statementImportFindMany.mockResolvedValue([
      statement({
        closingBalance: 500,
        paidAmount: 500,
        periodEnd: "2026-03-31",
        plans: [
          { remainingAmount: 489.91 },
          { remainingAmount: 2865.55 },
          { remainingAmount: null },
        ],
      }),
    ]);

    const result = await service.getOverview("user-1", {});
    const [card] = result.cards;

    expect(card.statementSummary.deferredInstallmentBalance).toBe(3355.46);
    expect(card.creditStatus.owedBalance).toBe(3355.46);
    expect(card.statementSummary.projectedTotalDebt).toBe(3355.46);
    expect(card.statementSummary.remainingStatement).toBe(0);
    expect(card.creditStatus.availableCredit).toBe(1000 - 3355.46);
    expect(result.portfolio.byCurrency[0]).toMatchObject({
      totalOwedBalance: 3355.46,
      totalDeferredInstallmentBalance: 3355.46,
    });
  });

  it("adds deferred installment balances on top of an unpaid statement", async () => {
    statementImportFindMany.mockResolvedValue([
      statement({
        closingBalance: 500,
        paidAmount: 100,
        periodEnd: "2026-03-31",
        paymentTargetCurrency: "MXN",
        paymentTargetAmount: 300,
        plans: [{ remainingAmount: 200 }],
      }),
    ]);

    const result = await service.getOverview("user-1", {});
    const [card] = result.cards;

    expect(card.statementSummary.currentPaymentDue).toBe(200);
    expect(card.statementSummary.remainingStatement).toBe(400);
    expect(card.statementSummary.deferredInstallmentBalance).toBe(200);
    expect(card.creditStatus.owedBalance).toBe(600);
    expect(card.statementSummary.projectedTotalDebt).toBe(600);
  });

  it("ignores deferred plans in another currency and reports zero without plans", async () => {
    statementImportFindMany.mockResolvedValue([
      statement({
        closingBalance: 500,
        paidAmount: 0,
        periodEnd: "2026-03-31",
        plans: [
          { remainingAmount: 900, currency: "USD" },
          { remainingAmount: 100 },
        ],
      }),
    ]);

    const result = await service.getOverview("user-1", {});
    expect(result.cards[0].statementSummary.deferredInstallmentBalance).toBe(
      100,
    );
    expect(result.cards[0].creditStatus.owedBalance).toBe(600);

    statementImportFindMany.mockResolvedValue([
      statement({
        closingBalance: 500,
        paidAmount: 0,
        periodEnd: "2026-03-31",
      }),
    ]);
    const without = await service.getOverview("user-1", {});
    expect(without.cards[0].statementSummary.deferredInstallmentBalance).toBe(
      0,
    );
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

  describe("next close payment estimate", () => {
    // System time 2026-04-08; the card closes on day 15 => next close 2026-04-15.
    it("estimates the next payment from plan installments only", async () => {
      statementImportFindMany.mockResolvedValue([
        statement({
          closingBalance: 500,
          paidAmount: 500,
          periodEnd: "2026-03-31",
          plans: [
            { remainingAmount: 1000, installmentAmount: 250 },
            { remainingAmount: 100, installmentAmount: 250 },
          ],
        }),
      ]);

      const { cards, portfolio } = await service.getOverview("user-1", {});
      const summary = cards[0].statementSummary;

      expect(summary.nextPlanInstallments).toBe(350);
      expect(summary.nextClosePaymentEstimate).toBe(350);
      expect(summary.projectedTotalDebt).toBe(1100);
      expect(summary.estimatedRemainingAfterNextClose).toBe(750);
      expect(portfolio.byCurrency[0]).toMatchObject({
        totalNextClosePaymentEstimate: 350,
        totalEstimatedRemainingAfterNextClose: 750,
      });
    });

    it("counts a whole installment group as debt but only the due installment in the estimate", async () => {
      statementImportFindMany.mockResolvedValue([
        statement({
          closingBalance: 0,
          paidAmount: 0,
          periodEnd: "2026-03-31",
        }),
      ]);
      mockExpenseQueries(
        [],
        [
          expense({
            id: "regular",
            cost: 50,
            date: "2026-04-02T00:00:00.000Z",
          }),
          installmentExpense({ id: "i1", cost: 100, date: "2026-04-10" }),
          installmentExpense({ id: "i2", cost: 100, date: "2026-05-10" }),
          installmentExpense({ id: "i3", cost: 100, date: "2026-06-10" }),
        ],
      );

      const summary = (await service.getOverview("user-1", {})).cards[0]
        .statementSummary;

      expect(summary.projectedTotalDebt).toBe(350);
      expect(summary.nextClosePaymentEstimate).toBe(150);
      expect(summary.estimatedRemainingAfterNextClose).toBe(200);
      // Existing field keeps its meaning: spend registered after the close.
      expect(summary.postCloseSpend).toBe(350);
      expect(summary.projectedNextCloseAmount).toBe(350);
    });

    it("still ignores future-dated regular expenses", async () => {
      statementImportFindMany.mockResolvedValue([
        statement({ closingBalance: 0, periodEnd: "2026-03-31" }),
      ]);
      mockExpenseQueries(
        [],
        [
          expense({ cost: 40, date: "2026-04-05T00:00:00.000Z" }),
          expense({ cost: 900, date: "2026-04-12T00:00:00.000Z" }),
        ],
      );

      const summary = (await service.getOverview("user-1", {})).cards[0]
        .statementSummary;

      expect(summary.projectedTotalDebt).toBe(40);
      expect(summary.nextClosePaymentEstimate).toBe(40);
    });

    it("ignores installment rows that fall on or before the statement period end", async () => {
      statementImportFindMany.mockResolvedValue([
        statement({ closingBalance: 0, periodEnd: "2026-03-31" }),
      ]);
      mockExpenseQueries(
        [],
        [installmentExpense({ cost: 100, date: "2026-03-31T10:00:00.000Z" })],
      );

      const summary = (await service.getOverview("user-1", {})).cards[0]
        .statementSummary;

      expect(summary.projectedTotalDebt).toBe(0);
      expect(summary.nextClosePaymentEstimate).toBe(0);
    });

    it("asks the database for future-dated installment rows and selects isInstallment", async () => {
      await service.getOverview("user-1", {});

      const unlinkedCall = (
        expenseFindMany.mock.calls as Array<
          [
            {
              where: Record<string, unknown>;
              select: Record<string, boolean>;
            },
          ]
        >
      ).find(([args]) => "statementRowId" in args.where);

      expect(unlinkedCall?.[0].select.isInstallment).toBe(true);
      expect(unlinkedCall?.[0].where.OR).toEqual([
        { date: { lte: new Date("2026-04-08T10:00:00.000Z") } },
        { isInstallment: true },
      ]);
    });

    it("excludes installment rows in another currency from money and warns", async () => {
      statementImportFindMany.mockResolvedValue([
        statement({ closingBalance: 0, periodEnd: "2026-03-31" }),
      ]);
      mockExpenseQueries(
        [],
        [
          installmentExpense({
            id: "usd",
            cost: 100,
            currency: "USD",
            date: "2026-04-10",
          }),
        ],
      );

      const [card] = (await service.getOverview("user-1", {})).cards;

      expect(card.statementSummary.projectedTotalDebt).toBe(0);
      expect(card.statementSummary.nextClosePaymentEstimate).toBe(0);
      expect(card.currencyMismatchCount).toBe(1);
    });

    it("ignores plans in another currency and finished plans", async () => {
      statementImportFindMany.mockResolvedValue([
        statement({
          closingBalance: 0,
          periodEnd: "2026-03-31",
          plans: [
            { remainingAmount: 900, installmentAmount: 300, currency: "USD" },
            { remainingAmount: 0, installmentAmount: 120 },
            { remainingAmount: null, installmentAmount: 80 },
          ],
        }),
      ]);

      const summary = (await service.getOverview("user-1", {})).cards[0]
        .statementSummary;

      expect(summary.nextPlanInstallments).toBe(0);
      expect(summary.nextClosePaymentEstimate).toBe(0);
    });

    it("reports zero estimates without a confirmed statement", async () => {
      mockExpenseQueries(
        [],
        [expense({ cost: 60, date: "2026-04-02T00:00:00.000Z" })],
      );

      const summary = (await service.getOverview("user-1", {})).cards[0]
        .statementSummary;

      expect(summary.nextPlanInstallments).toBe(0);
      expect(summary.nextClosePaymentEstimate).toBe(60);
      expect(summary.projectedTotalDebt).toBe(60);
      expect(summary.estimatedRemainingAfterNextClose).toBe(0);
    });

    it("uses only plans and regular post-close spend when the card has no closing day", async () => {
      creditCardFindMany.mockResolvedValue([{ ...card(), closingDay: null }]);
      statementImportFindMany.mockResolvedValue([
        statement({
          closingBalance: 0,
          periodEnd: "2026-03-31",
          plans: [{ remainingAmount: 500, installmentAmount: 100 }],
        }),
      ]);
      mockExpenseQueries(
        [],
        [
          expense({ cost: 30, date: "2026-04-02T00:00:00.000Z" }),
          installmentExpense({ cost: 70, date: "2026-04-10" }),
          installmentExpense({ cost: 70, date: "2026-05-10" }),
        ],
      );

      const summary = (await service.getOverview("user-1", {})).cards[0]
        .statementSummary;

      expect(summary.nextClosePaymentEstimate).toBe(130);
      expect(summary.projectedTotalDebt).toBe(670);
      expect(summary.estimatedRemainingAfterNextClose).toBe(540);
    });

    it("never reports a negative remainder", async () => {
      statementImportFindMany.mockResolvedValue([
        statement({
          closingBalance: 100,
          paidAmount: 0,
          periodEnd: "2026-03-31",
          plans: [{ remainingAmount: 50, installmentAmount: 50 }],
        }),
      ]);

      const summary = (await service.getOverview("user-1", {})).cards[0]
        .statementSummary;

      expect(summary.projectedTotalDebt).toBe(150);
      expect(summary.estimatedRemainingAfterNextClose).toBe(0);
    });

    it("matches the real-data sanity case", async () => {
      const pairs: Array<[number, number]> = [
        [5416.25, 1083.25],
        [611.67, 305.83],
        [499.25, 274.52],
        [480.67, 264.31],
        [276.13, 276.13],
        [242.66, 242.67],
        [191.24, 203.81],
        [153.1, 153.09],
      ];
      statementImportFindMany.mockResolvedValue([
        statement({
          closingBalance: 4000,
          paidAmount: 4000,
          periodEnd: "2026-03-31",
          plans: [
            ...pairs.map(([remainingAmount, installmentAmount]) => ({
              remainingAmount,
              installmentAmount,
            })),
            ...[0, 0, 0, 0].map((remainingAmount) => ({
              remainingAmount,
              installmentAmount: 150,
            })),
          ],
        }),
      ]);
      // 728 / 3 and 622 / 3 split as the expense service does (cents; the
      // last installment absorbs the remainder).
      const [a1, a2, a3] = splitAmountAcrossInstallments(728, 3);
      const [b1, b2, b3] = splitAmountAcrossInstallments(622, 3);
      mockExpenseQueries(
        [],
        [
          expense({ id: "r1", cost: 2000, date: "2026-04-02T00:00:00.000Z" }),
          expense({ id: "r2", cost: 1347.4, date: "2026-04-06T00:00:00.000Z" }),
          installmentExpense({ id: "a1", cost: a1, date: "2026-04-10" }),
          installmentExpense({ id: "a2", cost: a2, date: "2026-05-10" }),
          installmentExpense({ id: "a3", cost: a3, date: "2026-06-10" }),
          installmentExpense({ id: "b1", cost: b1, date: "2026-04-12" }),
          installmentExpense({ id: "b2", cost: b2, date: "2026-05-12" }),
          installmentExpense({ id: "b3", cost: b3, date: "2026-06-12" }),
        ],
      );

      const { cards, portfolio } = await service.getOverview("user-1", {});
      const summary = cards[0].statementSummary;

      expect([a1, b1]).toEqual([242.66, 207.33]);
      expect(summary.statementImportId).not.toBeNull();
      expect(summary.remainingStatement).toBe(0);
      expect(summary.deferredInstallmentBalance).toBe(7870.97);
      expect(summary.nextPlanInstallments).toBe(2791.03);
      expect(summary.postCloseSpend).toBe(4697.4);
      expect(summary.projectedTotalDebt).toBe(12568.37);
      expect(summary.nextClosePaymentEstimate).toBe(6588.42);
      expect(summary.estimatedRemainingAfterNextClose).toBe(5979.95);
      expect(portfolio.byCurrency[0]).toMatchObject({
        totalNextClosePaymentEstimate: 6588.42,
        totalEstimatedRemainingAfterNextClose: 5979.95,
      });
    });
  });

  function installmentExpense(
    overrides: Partial<{
      id: string;
      cost: number;
      currency: string;
      date: string;
    }> = {},
  ) {
    return expense({
      ...overrides,
      date: overrides.date?.includes("T")
        ? overrides.date
        : `${overrides.date ?? "2026-04-10"}T00:00:00.000Z`,
      isInstallment: true,
    });
  }

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
      isInstallment: boolean;
    }> = {},
  ) {
    return {
      id: overrides.id ?? "expense-1",
      creditCardId: overrides.creditCardId ?? "card-1",
      cost: overrides.cost ?? 100,
      currency: overrides.currency ?? "MXN",
      date: new Date(overrides.date ?? "2026-04-02T00:00:00.000Z"),
      isInstallment: overrides.isInstallment ?? false,
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
    plans?: Array<{
      remainingAmount: number | null;
      installmentAmount?: number | null;
      currency?: string;
    }>;
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
      financingPlans: (options.plans ?? []).map((plan) => ({
        remainingAmount: plan.remainingAmount,
        installmentAmount: plan.installmentAmount ?? null,
        currency: plan.currency ?? "MXN",
      })),
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
