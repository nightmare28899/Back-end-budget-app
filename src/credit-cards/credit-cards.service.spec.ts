import { CreditCardsService } from "./credit-cards.service";

describe("CreditCardsService", () => {
  type CreditCardRow = {
    id: string;
    name: string;
    bank: string;
    brand: string;
    last4: string;
    color: string | null;
    creditLimit: number | null;
    closingDay: number | null;
    paymentDueDay: number | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  };

  type ExpenseRow = {
    creditCardId: string | null;
    cost: number;
    date: Date;
  };

  type SubscriptionRow = {
    id: string;
    creditCardId: string | null;
    cost: number;
    currency: string;
    billingCycle: "MONTHLY" | "YEARLY" | "WEEKLY" | "DAILY";
    nextPaymentDate: Date;
    isActive: boolean;
  };

  type ExpenseQueryCall = {
    where: {
      userId: string;
      date: {
        gte: Date;
        lte: Date;
      };
    };
  };

  const creditCardFindMany = jest.fn<Promise<CreditCardRow[]>, [unknown]>();
  const expenseFindMany = jest.fn<Promise<ExpenseRow[]>, [ExpenseQueryCall]>();
  const subscriptionFindMany = jest.fn<Promise<SubscriptionRow[]>, [unknown]>();
  const entitlementsService = {
    assertPremium: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    creditCard: {
      findMany: creditCardFindMany,
    },
    expense: {
      findMany: expenseFindMany,
    },
    subscription: {
      findMany: subscriptionFindMany,
    },
  };

  let service: CreditCardsService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 3, 8, 10, 0, 0, 0));
    creditCardFindMany.mockReset();
    expenseFindMany.mockReset();
    subscriptionFindMany.mockReset();
    entitlementsService.assertPremium.mockClear();
    service = new CreditCardsService(
      prisma as never,
      entitlementsService as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("builds an overview with cycle spend, utilization, and schedule details", async () => {
    creditCardFindMany.mockResolvedValue([
      {
        id: "card-1",
        name: "Nu",
        bank: "Nu",
        brand: "VISA",
        last4: "4242",
        color: "#7C3AED",
        creditLimit: 1000,
        closingDay: 15,
        paymentDueDay: 25,
        isActive: true,
        createdAt: new Date(2026, 0, 1),
        updatedAt: new Date(2026, 3, 1),
      },
      {
        id: "card-2",
        name: "Travel",
        bank: "BBVA",
        brand: "MASTERCARD",
        last4: "9090",
        color: "#2563EB",
        creditLimit: null,
        closingDay: null,
        paymentDueDay: null,
        isActive: true,
        createdAt: new Date(2026, 1, 1),
        updatedAt: new Date(2026, 3, 1),
      },
    ]);
    expenseFindMany.mockResolvedValue([
      {
        creditCardId: "card-1",
        cost: 200,
        date: new Date(2026, 2, 20, 9, 0, 0, 0),
      },
      {
        creditCardId: "card-1",
        cost: 150,
        date: new Date(2026, 3, 5, 11, 0, 0, 0),
      },
      {
        creditCardId: "card-2",
        cost: 80,
        date: new Date(2026, 3, 2, 8, 30, 0, 0),
      },
    ]);
    subscriptionFindMany.mockResolvedValue([
      {
        id: "sub-1",
        creditCardId: "card-1",
        cost: 199,
        currency: "MXN",
        billingCycle: "MONTHLY",
        nextPaymentDate: new Date(2026, 3, 10, 12, 0, 0, 0),
        isActive: true,
      },
    ]);

    const result = await service.getOverview("user-1", {
      includeInactive: true,
    });
    const expenseQuery = expenseFindMany.mock.calls[0]?.[0];

    expect(entitlementsService.assertPremium).toHaveBeenCalledWith(
      "user-1",
      "credit_cards_catalog",
    );
    expect(result.referenceDate).toBe("2026-04-08");
    expect(expenseQuery).toBeDefined();
    expect(expenseQuery?.where.userId).toBe("user-1");
    expect(expenseQuery?.where.date.gte).toEqual(
      new Date(2026, 2, 16, 0, 0, 0, 0),
    );
    expect(expenseQuery?.where.date.lte).toEqual(
      new Date(2026, 3, 8, 10, 0, 0, 0),
    );
    expect(result.portfolio).toEqual({
      trackedCards: 2,
      activeCards: 2,
      cardsWithLimit: 1,
      totalCreditLimit: 1000,
      totalCurrentCycleSpend: 430,
      totalAvailableCredit: 650,
      utilizationPercent: 43,
      paymentDueSoonCount: 0,
      highUtilizationCount: 0,
      linkedSubscriptionsCount: 1,
      monthlyRecurringSpend: 199,
    });
    expect(result.cards[0]).toMatchObject({
      id: "card-1",
      currentCycle: {
        start: "2026-03-16",
        end: "2026-04-15",
        spend: 350,
        expenseCount: 2,
      },
      creditStatus: {
        limit: 1000,
        availableCredit: 650,
        utilizationPercent: 35,
      },
      schedule: {
        nextClosingDate: "2026-04-15",
        daysUntilClosing: 7,
        nextPaymentDueDate: "2026-04-25",
        daysUntilPaymentDue: 17,
      },
      subscriptions: {
        activeCount: 1,
        monthlyRecurringSpend: 199,
        nextChargeDate: "2026-04-10",
      },
      flags: {
        missingLimit: false,
        highUtilization: false,
        overLimit: false,
        paymentDueSoon: false,
        closingSoon: false,
      },
    });
    expect(result.cards[1]).toMatchObject({
      id: "card-2",
      currentCycle: {
        start: "2026-04-01",
        end: "2026-04-30",
        spend: 80,
        expenseCount: 1,
      },
      creditStatus: {
        limit: null,
        availableCredit: null,
        utilizationPercent: null,
      },
      flags: {
        missingLimit: true,
      },
    });
  });
});
