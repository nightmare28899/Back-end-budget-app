import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  BillingCycle,
  PaymentMethod,
  StatementImportStatus,
  StatementPaymentTargetKind,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCreditCardDto } from "./dto/create-credit-card.dto";
import { UpdateCreditCardDto } from "./dto/update-credit-card.dto";
import { QueryCreditCardsDto } from "./dto/query-credit-cards.dto";
import { creditCardPublicSelect } from "./credit-card.select";
import { isCreditCardPaymentMethod } from "../common/payments/payment-method.utils";
import { EntitlementsService } from "../common/entitlements/entitlements.service";
import { formatDateOnly } from "../common/budget/budget.utils";
import {
  calculateStatementPaymentSummary,
  type StatementPaymentSummary,
} from "../card-statements/statement-payment-summary";

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
  currency: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type CreditCardExpenseRow = {
  id: string;
  creditCardId: string | null;
  cost: number;
  date: Date;
  currency: string;
};

type CreditCardSubscriptionRow = {
  id: string;
  creditCardId: string | null;
  cost: number;
  currency: string;
  billingCycle: BillingCycle;
  nextPaymentDate: Date;
  isActive: boolean;
};

type ConfirmedStatementRow = {
  id: string;
  creditCardId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
  paymentSummary: StatementPaymentSummary;
  financingPlans: Array<{ remainingAmount: number | null; currency: string }>;
  paymentTargets: Array<{
    kind: StatementPaymentTargetKind;
    amount: number;
    currency: string;
    dueDate: Date | null;
    position: number;
  }>;
};

type UnbilledExpenseRow = {
  id: string;
  creditCardId: string | null;
  cost: number;
  currency: string;
  date: Date;
};

@Injectable()
export class CreditCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  async create(userId: string, dto: CreateCreditCardDto) {
    await this.entitlementsService.assertPremium(
      userId,
      "credit_cards_catalog",
    );
    return this.prisma.creditCard.create({
      data: {
        userId,
        name: dto.name,
        bank: dto.bank,
        brand: dto.brand,
        last4: dto.last4,
        color: dto.color,
        creditLimit: dto.creditLimit,
        closingDay: dto.closingDay,
        paymentDueDay: dto.paymentDueDay,
        currency: dto.currency ?? "MXN",
        isActive: dto.isActive ?? true,
      },
      select: creditCardPublicSelect,
    });
  }

  async findAll(userId: string, query?: QueryCreditCardsDto) {
    await this.entitlementsService.assertPremium(
      userId,
      "credit_cards_catalog",
    );

    return this.prisma.creditCard.findMany({
      where: {
        userId,
        ...(query?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }, { createdAt: "desc" }],
      select: creditCardPublicSelect,
    });
  }

  async findOne(id: string, userId: string, includeInactive = true) {
    await this.entitlementsService.assertPremium(
      userId,
      "credit_cards_catalog",
    );

    const card = await this.prisma.creditCard.findFirst({
      where: {
        id,
        userId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      select: creditCardPublicSelect,
    });

    if (!card) {
      throw new NotFoundException("Credit card not found");
    }

    return card;
  }

  async getOverview(userId: string, query?: QueryCreditCardsDto) {
    await this.entitlementsService.assertPremium(
      userId,
      "credit_cards_catalog",
    );

    const now = new Date();
    const cards = (await this.prisma.creditCard.findMany({
      where: {
        userId,
        ...(query?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }, { createdAt: "desc" }],
      select: creditCardPublicSelect,
    })) as CreditCardRow[];

    if (cards.length === 0) {
      return {
        referenceDate: formatDateOnly(now),
        portfolio: {
          trackedCards: 0,
          activeCards: 0,
          cardsWithLimit: 0,
          byCurrency: [],
          paymentDueSoonCount: 0,
          highUtilizationCount: 0,
          linkedSubscriptionsCount: 0,
        },
        cards: [],
      };
    }

    const cycleStarts = cards.map((card) => {
      return this.resolveCurrentCycleWindow(card.closingDay, now).start;
    });
    const oldestCycleStart = new Date(
      Math.min(...cycleStarts.map((date) => date.getTime())),
    );

    const [
      expenseRows,
      subscriptionRows,
      confirmedStatementRows,
      unbilledExpenseRows,
    ] = await Promise.all([
      this.prisma.expense.findMany({
        where: {
          userId,
          creditCardId: { in: cards.map((card) => card.id) },
          date: {
            gte: oldestCycleStart,
            lte: now,
          },
        },
        select: {
          id: true,
          creditCardId: true,
          cost: true,
          date: true,
          currency: true,
        },
      }),
      this.prisma.subscription.findMany({
        where: {
          userId,
          creditCardId: { in: cards.map((card) => card.id) },
          isActive: true,
        },
        select: {
          id: true,
          creditCardId: true,
          cost: true,
          currency: true,
          billingCycle: true,
          nextPaymentDate: true,
          isActive: true,
        },
      }),
      // Ordering here makes the first matching-currency statement per card
      // the sole rolling balance source; older statements remain evidence.
      this.prisma.statementImport.findMany({
        where: {
          userId,
          creditCardId: { in: cards.map((card) => card.id) },
          status: StatementImportStatus.CONFIRMED,
        },
        select: {
          creditCardId: true,
          id: true,
          periodStart: true,
          periodEnd: true,
          createdAt: true,
          reconciliation: {
            select: { closingBalance: true, currency: true, status: true },
          },
          paymentTargets: {
            select: {
              kind: true,
              amount: true,
              currency: true,
              dueDate: true,
              position: true,
            },
            orderBy: { position: "asc" },
          },
          payments: {
            select: { amount: true, currency: true, voidedAt: true },
          },
          financingPlans: {
            select: { remainingAmount: true, currency: true },
          },
        },
        orderBy: [
          { periodEnd: { sort: "desc", nulls: "last" } },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      }),
      // Credit-card expenses never reconciled into a statement (manual
      // entries, or spend since the last import) are also real debt — but
      // only once their date has actually arrived, so future-dated
      // installment rows aren't counted before they're due.
      this.prisma.expense.findMany({
        where: {
          userId,
          creditCardId: { in: cards.map((card) => card.id) },
          statementRowId: null,
          date: { lte: now },
        },
        select: {
          id: true,
          creditCardId: true,
          cost: true,
          currency: true,
          date: true,
        },
      }),
    ]);
    const expenses: CreditCardExpenseRow[] = expenseRows.map((expense) => ({
      id: expense.id,
      creditCardId: expense.creditCardId,
      cost: Number(expense.cost ?? 0),
      date: expense.date,
      currency: expense.currency,
    }));
    const subscriptions: CreditCardSubscriptionRow[] = subscriptionRows.map(
      (subscription) => ({
        id: subscription.id,
        creditCardId: subscription.creditCardId,
        cost: Number(subscription.cost ?? 0),
        currency: subscription.currency,
        billingCycle: subscription.billingCycle,
        nextPaymentDate: subscription.nextPaymentDate,
        isActive: subscription.isActive,
      }),
    );
    const confirmedStatements: ConfirmedStatementRow[] =
      confirmedStatementRows.map((statement) => ({
        id: statement.id,
        creditCardId: statement.creditCardId,
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        createdAt: statement.createdAt,
        paymentSummary: calculateStatementPaymentSummary(statement),
        financingPlans: (statement.financingPlans ?? []).map((plan) => ({
          remainingAmount:
            plan.remainingAmount == null ? null : Number(plan.remainingAmount),
          currency: plan.currency,
        })),
        paymentTargets: statement.paymentTargets.map((target) => ({
          kind: target.kind,
          amount: Number(target.amount),
          currency: target.currency,
          dueDate: target.dueDate,
          position: target.position,
        })),
      }));
    const unbilledExpenses: UnbilledExpenseRow[] = unbilledExpenseRows.map(
      (expense) => ({
        id: expense.id,
        creditCardId: expense.creditCardId,
        cost: Number(expense.cost ?? 0),
        currency: expense.currency,
        date: expense.date,
      }),
    );

    const overviewCards = cards.map((card) => {
      const cycleWindow = this.resolveCurrentCycleWindow(card.closingDay, now);
      const schedule = this.resolveSchedule(card, now);
      const cardExpenses = expenses.filter(
        (expense) =>
          expense.creditCardId === card.id &&
          expense.date.getTime() >= cycleWindow.start.getTime() &&
          expense.date.getTime() <= now.getTime(),
      );
      const matchingCardExpenses = cardExpenses.filter(
        (expense) => expense.currency === card.currency,
      );
      const activeSubscriptions = subscriptions.filter(
        (subscription) =>
          subscription.creditCardId === card.id && subscription.isActive,
      );
      const matchingSubscriptions = activeSubscriptions.filter(
        (subscription) => subscription.currency === card.currency,
      );
      const cardStatements = confirmedStatements.filter(
        (statement) => statement.creditCardId === card.id,
      );
      const matchingStatements = cardStatements.filter(
        (statement) => statement.paymentSummary.currency === card.currency,
      );
      const [latestStatement, previousStatement] = matchingStatements;
      // What is still due can never be less than what the statement asks to
      // pay now: some issuers put installment charges in the no-interest
      // target without including them in the closing balance.
      const statementBalance = Math.max(
        latestStatement?.paymentSummary.remainingStatement ?? 0,
        latestStatement?.paymentSummary.currentPaymentDue ?? 0,
      );
      // The remaining balance of installment plans is owed but is not part of
      // this statement's payment: the issuer only bills the current instalment.
      const deferredInstallmentBalance = this.roundMoney(
        (latestStatement?.financingPlans ?? [])
          .filter((plan) => plan.currency === card.currency)
          .reduce((sum, plan) => sum + (plan.remainingAmount ?? 0), 0),
      );
      const statementPeriodEnd = latestStatement?.periodEnd
        ? this.utcDayEnd(latestStatement.periodEnd)
        : null;
      const cardUnbilledExpenses = unbilledExpenses.filter(
        (expense) =>
          expense.creditCardId === card.id &&
          expense.date.getTime() <= now.getTime() &&
          (!statementPeriodEnd ||
            expense.date.getTime() > statementPeriodEnd.getTime()),
      );
      const matchingUnbilledExpenses = cardUnbilledExpenses.filter(
        (expense) => expense.currency === card.currency,
      );
      const currentCycleSpend = this.roundMoney(
        matchingCardExpenses.reduce(
          (sum, expense) => sum + Number(expense.cost ?? 0),
          0,
        ),
      );
      const monthlyRecurringSpend = this.roundMoney(
        matchingSubscriptions.reduce(
          (sum, subscription) =>
            sum +
            Number(subscription.cost ?? 0) *
              this.getMonthlyFactor(subscription.billingCycle),
          0,
        ),
      );
      const limit =
        card.creditLimit == null
          ? null
          : this.roundMoney(Number(card.creditLimit));
      const outstandingBalance = this.roundMoney(
        statementBalance +
          deferredInstallmentBalance +
          matchingUnbilledExpenses.reduce(
            (sum, expense) => sum + expense.cost,
            0,
          ),
      );
      const availableCredit =
        limit == null ? null : this.roundMoney(limit - outstandingBalance);
      const utilizationPercent =
        limit && limit > 0
          ? this.roundPercent((outstandingBalance / limit) * 100)
          : null;
      const nextPaymentTarget = latestStatement?.paymentTargets.find(
        (target) => target.kind === StatementPaymentTargetKind.NO_INTEREST,
      );
      const previousPaymentTarget = previousStatement?.paymentTargets.find(
        (target) => target.kind === StatementPaymentTargetKind.NO_INTEREST,
      );
      const nextPayment =
        latestStatement?.paymentSummary.currentPaymentDue != null &&
        latestStatement.paymentSummary.currentPaymentDue > 0
          ? {
              amount: latestStatement.paymentSummary.currentPaymentDue,
              currency: card.currency,
              dueDate: latestStatement.paymentSummary.dueDate
                ? formatDateOnly(
                    new Date(latestStatement.paymentSummary.dueDate),
                  )
                : null,
              previousAmount:
                previousPaymentTarget?.currency === card.currency
                  ? previousPaymentTarget.amount
                  : null,
            }
          : null;
      const nextChargeDate =
        matchingSubscriptions.length > 0
          ? matchingSubscriptions
              .map((subscription) => subscription.nextPaymentDate)
              .sort((left, right) => left.getTime() - right.getTime())[0]
          : null;
      const mismatchedExpenseIds = new Set([
        ...cardExpenses
          .filter((expense) => expense.currency !== card.currency)
          .map((expense) => expense.id),
        ...cardUnbilledExpenses
          .filter((expense) => expense.currency !== card.currency)
          .map((expense) => expense.id),
      ]);
      const currencyMismatchCount =
        cardStatements.length -
        matchingStatements.length +
        mismatchedExpenseIds.size +
        (nextPaymentTarget && nextPaymentTarget.currency !== card.currency
          ? 1
          : 0) +
        (activeSubscriptions.length - matchingSubscriptions.length);

      return {
        id: card.id,
        name: card.name,
        bank: card.bank,
        brand: card.brand,
        last4: card.last4,
        color: card.color,
        creditLimit: limit,
        closingDay: card.closingDay,
        paymentDueDay: card.paymentDueDay,
        isActive: card.isActive,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
        currency: card.currency,
        currentCycle: {
          currency: card.currency,
          start: formatDateOnly(cycleWindow.start),
          end: formatDateOnly(cycleWindow.end),
          spend: currentCycleSpend,
          expenseCount: matchingCardExpenses.length,
          currencyMismatchCount:
            cardExpenses.length - matchingCardExpenses.length,
        },
        creditStatus: {
          currency: card.currency,
          limit,
          availableCredit,
          utilizationPercent,
          owedBalance: outstandingBalance,
        },
        statementSummary: {
          statementImportId: latestStatement?.id ?? null,
          periodStart: latestStatement?.periodStart
            ? formatDateOnly(latestStatement.periodStart)
            : null,
          periodEnd: latestStatement?.periodEnd
            ? formatDateOnly(latestStatement.periodEnd)
            : null,
          closingBalance:
            latestStatement?.paymentSummary.closingBalance ?? null,
          paidTotal: latestStatement?.paymentSummary.paidTotal ?? 0,
          paymentStatus:
            latestStatement?.paymentSummary.paymentStatus ?? "UNPAID",
          remainingStatement: this.roundMoney(statementBalance),
          deferredInstallmentBalance,
          noInterestTarget:
            latestStatement?.paymentSummary.noInterestTarget ?? null,
          currentPaymentDue:
            latestStatement?.paymentSummary.currentPaymentDue ?? null,
          dueDate: latestStatement?.paymentSummary.dueDate
            ? formatDateOnly(new Date(latestStatement.paymentSummary.dueDate))
            : null,
          postCloseSpend: this.roundMoney(
            matchingUnbilledExpenses.reduce(
              (sum, expense) => sum + expense.cost,
              0,
            ),
          ),
          postCloseExpenseCount: matchingUnbilledExpenses.length,
          projectedNextCloseDate: schedule.nextClosingDate
            ? formatDateOnly(schedule.nextClosingDate)
            : null,
          projectedNextCloseAmount: this.roundMoney(
            matchingUnbilledExpenses.reduce(
              (sum, expense) => sum + expense.cost,
              0,
            ),
          ),
          projectedTotalDebt: outstandingBalance,
          overpaid: latestStatement?.paymentSummary.overpaid ?? 0,
          integrityFlags: latestStatement?.paymentSummary.integrityFlags ?? {
            missingReconciliation: true,
            failedReconciliation: false,
            missingPaymentBasis: true,
            conflictingNoInterestTargets: false,
          },
        },
        nextPayment,
        schedule: {
          nextClosingDate: schedule.nextClosingDate
            ? formatDateOnly(schedule.nextClosingDate)
            : null,
          daysUntilClosing: schedule.daysUntilClosing,
          nextPaymentDueDate: schedule.nextPaymentDueDate
            ? formatDateOnly(schedule.nextPaymentDueDate)
            : null,
          daysUntilPaymentDue: schedule.daysUntilPaymentDue,
        },
        subscriptions: {
          currency: card.currency,
          activeCount: matchingSubscriptions.length,
          monthlyRecurringSpend,
          nextChargeDate: nextChargeDate
            ? formatDateOnly(nextChargeDate)
            : null,
          currencyMismatchCount:
            activeSubscriptions.length - matchingSubscriptions.length,
        },
        currencyMismatchCount,
        flags: {
          missingLimit: limit == null,
          highUtilization:
            utilizationPercent != null && utilizationPercent >= 70,
          overLimit: availableCredit != null && availableCredit < 0,
          paymentDueSoon:
            schedule.daysUntilPaymentDue != null &&
            schedule.daysUntilPaymentDue >= 0 &&
            schedule.daysUntilPaymentDue <= 7,
          closingSoon:
            schedule.daysUntilClosing != null &&
            schedule.daysUntilClosing >= 0 &&
            schedule.daysUntilClosing <= 5,
          currencyMismatch: currencyMismatchCount > 0,
        },
      };
    });

    const activeOverviewCards = overviewCards.filter((card) => card.isActive);
    const cardsWithLimit = activeOverviewCards.filter(
      (card) => card.creditStatus.limit != null && card.creditStatus.limit > 0,
    ).length;

    return {
      referenceDate: formatDateOnly(now),
      portfolio: {
        trackedCards: cards.length,
        activeCards: activeOverviewCards.length,
        cardsWithLimit,
        byCurrency: this.buildPortfolioCurrencySummaries(activeOverviewCards),
        paymentDueSoonCount: activeOverviewCards.filter(
          (card) => card.flags.paymentDueSoon,
        ).length,
        highUtilizationCount: activeOverviewCards.filter(
          (card) => card.flags.highUtilization || card.flags.overLimit,
        ).length,
        linkedSubscriptionsCount: activeOverviewCards.reduce(
          (sum, card) => sum + card.subscriptions.activeCount,
          0,
        ),
      },
      cards: overviewCards,
    };
  }

  async update(id: string, userId: string, dto: UpdateCreditCardDto) {
    await this.findOne(id, userId);

    return this.prisma.creditCard.update({
      where: { id },
      data: {
        name: dto.name,
        bank: dto.bank,
        brand: dto.brand,
        last4: dto.last4,
        color: dto.color,
        creditLimit: dto.creditLimit,
        closingDay: dto.closingDay,
        paymentDueDay: dto.paymentDueDay,
        currency: dto.currency,
        isActive: dto.isActive,
      },
      select: creditCardPublicSelect,
    });
  }

  async deactivate(id: string, userId: string) {
    await this.findOne(id, userId);

    return this.prisma.creditCard.update({
      where: { id },
      data: { isActive: false },
      select: creditCardPublicSelect,
    });
  }

  async resolveLinkedCreditCardId(params: {
    userId: string;
    paymentMethod?: PaymentMethod | null;
    creditCardId?: string | null;
    existingCreditCardId?: string | null;
  }): Promise<string | null> {
    if (!isCreditCardPaymentMethod(params.paymentMethod)) {
      return null;
    }

    await this.entitlementsService.assertPremium(
      params.userId,
      "credit_cards_catalog",
    );

    const cardId = params.creditCardId ?? params.existingCreditCardId ?? null;

    if (!cardId) {
      throw new BadRequestException(
        "creditCardId is required when paymentMethod is CREDIT_CARD",
      );
    }

    await this.assertAssignableCard(params.userId, cardId, {
      allowInactive: params.existingCreditCardId === cardId,
    });

    return cardId;
  }

  private async assertAssignableCard(
    userId: string,
    creditCardId: string,
    options?: { allowInactive?: boolean },
  ) {
    const card = await this.prisma.creditCard.findFirst({
      where: {
        id: creditCardId,
        userId,
      },
      select: {
        id: true,
        isActive: true,
      },
    });

    if (!card) {
      throw new BadRequestException("Selected credit card is not available");
    }

    if (!options?.allowInactive && !card.isActive) {
      throw new BadRequestException("Selected credit card is inactive");
    }
  }

  private resolveCurrentCycleWindow(closingDay: number | null, now: Date) {
    if (!closingDay || closingDay < 1 || closingDay > 31) {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    const currentClose = this.resolveMonthlyDay(now, closingDay, true);

    if (now.getTime() <= currentClose.getTime()) {
      const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousClose = this.resolveMonthlyDay(
        previousMonth,
        closingDay,
        true,
      );
      const start = new Date(previousClose);
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      return { start, end: currentClose };
    }

    const start = new Date(currentClose);
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const end = this.resolveMonthlyDay(nextMonth, closingDay, true);
    return { start, end };
  }

  private resolveSchedule(card: CreditCardRow, now: Date) {
    const nextClosingDate = card.closingDay
      ? this.resolveUpcomingDay(card.closingDay, now)
      : null;
    const nextPaymentDueDate = card.paymentDueDay
      ? this.resolveUpcomingDay(card.paymentDueDay, now)
      : null;

    return {
      nextClosingDate,
      daysUntilClosing:
        nextClosingDate == null ? null : this.daysUntil(nextClosingDate, now),
      nextPaymentDueDate,
      daysUntilPaymentDue:
        nextPaymentDueDate == null
          ? null
          : this.daysUntil(nextPaymentDueDate, now),
    };
  }

  private resolveUpcomingDay(day: number, now: Date) {
    if (day < 1 || day > 31) {
      return null;
    }

    const currentMonthDate = this.resolveMonthlyDay(now, day, true);
    if (now.getTime() <= currentMonthDate.getTime()) {
      return currentMonthDate;
    }

    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return this.resolveMonthlyDay(nextMonth, day, true);
  }

  private resolveMonthlyDay(anchor: Date, day: number, endOfDay = false) {
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const maxDay = new Date(year, month + 1, 0).getDate();
    const safeDay = Math.max(1, Math.min(day, maxDay));
    const date = new Date(year, month, safeDay);
    if (endOfDay) {
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    return date;
  }

  private daysUntil(target: Date, now: Date) {
    const targetDate = new Date(target);
    targetDate.setHours(0, 0, 0, 0);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return Math.round(
      (targetDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
    );
  }

  private getMonthlyFactor(cycle: BillingCycle) {
    switch (cycle) {
      case BillingCycle.DAILY:
        return 365 / 12;
      case BillingCycle.WEEKLY:
        return 52 / 12;
      case BillingCycle.YEARLY:
        return 1 / 12;
      case BillingCycle.MONTHLY:
      default:
        return 1;
    }
  }

  private roundMoney(value: number) {
    return Number(value.toFixed(2));
  }

  private roundPercent(value: number) {
    return Number(value.toFixed(1));
  }

  private utcDayEnd(value: Date) {
    const end = new Date(value);
    end.setUTCHours(23, 59, 59, 999);
    return end;
  }

  private buildPortfolioCurrencySummaries(
    cards: Array<{
      currency: string;
      currentCycle: { spend: number };
      creditStatus: {
        limit: number | null;
        availableCredit: number | null;
        owedBalance: number;
      };
      subscriptions: { monthlyRecurringSpend: number };
      statementSummary: {
        closingBalance: number | null;
        paidTotal: number;
        remainingStatement: number;
        deferredInstallmentBalance: number;
        currentPaymentDue: number | null;
        postCloseSpend: number;
        postCloseExpenseCount: number;
        projectedNextCloseAmount: number;
        projectedTotalDebt: number;
        dueDate: string | null;
        projectedNextCloseDate: string | null;
      };
    }>,
  ) {
    const currencies = [...new Set(cards.map((card) => card.currency))].sort();
    return currencies.map((currency) => {
      const currencyCards = cards.filter((card) => card.currency === currency);
      const totalCreditLimit = this.roundMoney(
        currencyCards.reduce(
          (sum, card) => sum + (card.creditStatus.limit ?? 0),
          0,
        ),
      );
      const totalOwedBalance = this.roundMoney(
        currencyCards.reduce(
          (sum, card) => sum + card.creditStatus.owedBalance,
          0,
        ),
      );
      // Utilization only compares balances against cards that have a limit.
      const limitedOwedBalance = this.roundMoney(
        currencyCards.reduce(
          (sum, card) =>
            (card.creditStatus.limit ?? 0) > 0
              ? sum + card.creditStatus.owedBalance
              : sum,
          0,
        ),
      );
      const earliestDate = (values: Array<string | null>) =>
        values
          .filter((value): value is string => value !== null)
          .sort((left, right) => left.localeCompare(right))[0] ?? null;
      return {
        currency,
        cardCount: currencyCards.length,
        totalCreditLimit,
        totalCurrentCycleSpend: this.roundMoney(
          currencyCards.reduce((sum, card) => sum + card.currentCycle.spend, 0),
        ),
        totalAvailableCredit: this.roundMoney(
          currencyCards.reduce(
            (sum, card) => sum + (card.creditStatus.availableCredit ?? 0),
            0,
          ),
        ),
        totalOwedBalance,
        totalClosingBalance: this.roundMoney(
          currencyCards.reduce(
            (sum, card) => sum + (card.statementSummary.closingBalance ?? 0),
            0,
          ),
        ),
        totalPaid: this.roundMoney(
          currencyCards.reduce(
            (sum, card) => sum + card.statementSummary.paidTotal,
            0,
          ),
        ),
        totalStatementRemainder: this.roundMoney(
          currencyCards.reduce(
            (sum, card) => sum + card.statementSummary.remainingStatement,
            0,
          ),
        ),
        totalDeferredInstallmentBalance: this.roundMoney(
          currencyCards.reduce(
            (sum, card) =>
              sum + card.statementSummary.deferredInstallmentBalance,
            0,
          ),
        ),
        totalCurrentPaymentDue: this.roundMoney(
          currencyCards.reduce(
            (sum, card) => sum + (card.statementSummary.currentPaymentDue ?? 0),
            0,
          ),
        ),
        earliestPaymentDueDate: earliestDate(
          currencyCards.map((card) => card.statementSummary.dueDate),
        ),
        totalPostCloseSpend: this.roundMoney(
          currencyCards.reduce(
            (sum, card) => sum + card.statementSummary.postCloseSpend,
            0,
          ),
        ),
        postCloseExpenseCount: currencyCards.reduce(
          (sum, card) => sum + card.statementSummary.postCloseExpenseCount,
          0,
        ),
        totalProjectedNextCloseAmount: this.roundMoney(
          currencyCards.reduce(
            (sum, card) => sum + card.statementSummary.projectedNextCloseAmount,
            0,
          ),
        ),
        earliestProjectedNextCloseDate: earliestDate(
          currencyCards.map(
            (card) => card.statementSummary.projectedNextCloseDate,
          ),
        ),
        totalProjectedDebt: this.roundMoney(
          currencyCards.reduce(
            (sum, card) => sum + card.statementSummary.projectedTotalDebt,
            0,
          ),
        ),
        utilizationPercent:
          totalCreditLimit > 0
            ? this.roundPercent((limitedOwedBalance / totalCreditLimit) * 100)
            : null,
        monthlyRecurringSpend: this.roundMoney(
          currencyCards.reduce(
            (sum, card) => sum + card.subscriptions.monthlyRecurringSpend,
            0,
          ),
        ),
      };
    });
  }
}
