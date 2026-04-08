import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { BillingCycle, PaymentMethod } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCreditCardDto } from "./dto/create-credit-card.dto";
import { UpdateCreditCardDto } from "./dto/update-credit-card.dto";
import { QueryCreditCardsDto } from "./dto/query-credit-cards.dto";
import { creditCardPublicSelect } from "./credit-card.select";
import { isCreditCardPaymentMethod } from "../common/payments/payment-method.utils";
import { EntitlementsService } from "../common/entitlements/entitlements.service";
import { formatDateOnly } from "../common/budget/budget.utils";

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

type CreditCardExpenseRow = {
  creditCardId: string | null;
  cost: number;
  date: Date;
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
          totalCreditLimit: 0,
          totalCurrentCycleSpend: 0,
          totalAvailableCredit: 0,
          utilizationPercent: null,
          paymentDueSoonCount: 0,
          highUtilizationCount: 0,
          linkedSubscriptionsCount: 0,
          monthlyRecurringSpend: 0,
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

    const [expenseRows, subscriptionRows] = await Promise.all([
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
          creditCardId: true,
          cost: true,
          date: true,
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
    ]);
    const expenses: CreditCardExpenseRow[] = expenseRows.map((expense) => ({
      creditCardId: expense.creditCardId,
      cost: Number(expense.cost ?? 0),
      date: expense.date,
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

    const overviewCards = cards.map((card) => {
      const cycleWindow = this.resolveCurrentCycleWindow(card.closingDay, now);
      const schedule = this.resolveSchedule(card, now);
      const cardExpenses = expenses.filter(
        (expense) =>
          expense.creditCardId === card.id &&
          expense.date.getTime() >= cycleWindow.start.getTime() &&
          expense.date.getTime() <= now.getTime(),
      );
      const activeSubscriptions = subscriptions.filter(
        (subscription) =>
          subscription.creditCardId === card.id && subscription.isActive,
      );
      const currentCycleSpend = this.roundMoney(
        cardExpenses.reduce(
          (sum, expense) => sum + Number(expense.cost ?? 0),
          0,
        ),
      );
      const monthlyRecurringSpend = this.roundMoney(
        activeSubscriptions.reduce(
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
      const availableCredit =
        limit == null ? null : this.roundMoney(limit - currentCycleSpend);
      const utilizationPercent =
        limit && limit > 0
          ? this.roundPercent((currentCycleSpend / limit) * 100)
          : null;
      const nextChargeDate =
        activeSubscriptions.length > 0
          ? activeSubscriptions
              .map((subscription) => subscription.nextPaymentDate)
              .sort((left, right) => left.getTime() - right.getTime())[0]
          : null;

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
        currentCycle: {
          start: formatDateOnly(cycleWindow.start),
          end: formatDateOnly(cycleWindow.end),
          spend: currentCycleSpend,
          expenseCount: cardExpenses.length,
        },
        creditStatus: {
          limit,
          availableCredit,
          utilizationPercent,
        },
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
          activeCount: activeSubscriptions.length,
          monthlyRecurringSpend,
          nextChargeDate: nextChargeDate
            ? formatDateOnly(nextChargeDate)
            : null,
        },
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
        },
      };
    });

    const activeOverviewCards = overviewCards.filter((card) => card.isActive);
    const totalCreditLimit = this.roundMoney(
      activeOverviewCards.reduce(
        (sum, card) => sum + (card.creditStatus.limit ?? 0),
        0,
      ),
    );
    const totalCurrentCycleSpend = this.roundMoney(
      activeOverviewCards.reduce(
        (sum, card) => sum + card.currentCycle.spend,
        0,
      ),
    );
    const totalAvailableCredit = this.roundMoney(
      activeOverviewCards.reduce(
        (sum, card) => sum + (card.creditStatus.availableCredit ?? 0),
        0,
      ),
    );
    const cardsWithLimit = activeOverviewCards.filter(
      (card) => card.creditStatus.limit != null && card.creditStatus.limit > 0,
    ).length;

    return {
      referenceDate: formatDateOnly(now),
      portfolio: {
        trackedCards: cards.length,
        activeCards: activeOverviewCards.length,
        cardsWithLimit,
        totalCreditLimit,
        totalCurrentCycleSpend,
        totalAvailableCredit,
        utilizationPercent:
          totalCreditLimit > 0
            ? this.roundPercent(
                (totalCurrentCycleSpend / totalCreditLimit) * 100,
              )
            : null,
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
        monthlyRecurringSpend: this.roundMoney(
          activeOverviewCards.reduce(
            (sum, card) => sum + card.subscriptions.monthlyRecurringSpend,
            0,
          ),
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
}
