import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { BillingCycle, PaymentMethod, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSubscriptionDto } from "./dto/create-subscription.dto";
import { UpdateSubscriptionDto } from "./dto/update-subscription.dto";
import { CreditCardsService } from "../credit-cards/credit-cards.service";
import { creditCardPublicSelect } from "../credit-cards/credit-card.select";
import { normalizePaymentMethod } from "../common/payments/payment-method.utils";
import {
  SubscriptionReminderCandidate,
  SubscriptionsWorkerService,
} from "./subscriptions.worker.service";

export interface ProjectionCurrencyItem {
  currency: string;
  monthlyCost: number;
}

export interface MonthlyProjectionResult {
  message: string;
  activeCount: number;
  totalMonthlyCost: number;
  currency: string | null;
  currencyBreakdown: ProjectionCurrencyItem[];
}

export interface UpcomingSubscriptionItem {
  id?: string;
  subscriptionId?: string;
  name: string;
  amount: number;
  currency: string;
  daysRemaining: number;
  chargeDate: string;
  nextPaymentDate: string;
  paymentMethod?: PaymentMethod;
  creditCard?: {
    id: string;
    name: string;
    bank: string;
    brand: string;
    last4: string;
    color: string | null;
    creditLimit: Prisma.Decimal | null;
    closingDay: number | null;
    paymentDueDay: number | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  } | null;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creditCardsService: CreditCardsService,
    private readonly subscriptionsWorkerService: SubscriptionsWorkerService,
  ) {}

  async create(userId: string, dto: CreateSubscriptionDto) {
    const now = new Date();
    const nextPaymentDate = this.parseDate(dto.nextPaymentDate);
    this.assertFutureDate(nextPaymentDate);
    const paymentMethod =
      normalizePaymentMethod(dto.paymentMethod) ?? PaymentMethod.CREDIT_CARD;
    const creditCardId = await this.creditCardsService.resolveLinkedCreditCardId(
      {
        userId,
        paymentMethod,
        creditCardId: dto.creditCardId,
      },
    );

    const subscription = await this.prisma.subscription.create({
      data: {
        userId,
        name: dto.name,
        cost: dto.cost,
        paymentMethod,
        creditCardId,
        currency: dto.currency ?? "MXN",
        billingCycle: dto.billingCycle as BillingCycle,
        nextPaymentDate,
        reminderDays: dto.reminderDays ?? 3,
        isActive: dto.isActive ?? true,
        logoUrl: dto.logoUrl,
        hexColor: dto.hexColor,
      },
      include: {
        creditCard: { select: creditCardPublicSelect },
      },
    });

    await this.sendImmediateSameDayReminderIfNeeded(subscription, now);

    return subscription;
  }

  async findAll(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId },
      include: {
        creditCard: { select: creditCardPublicSelect },
      },
      orderBy: { nextPaymentDate: "asc" },
    });
  }

  async findOne(id: string, userId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id, userId },
      include: {
        creditCard: { select: creditCardPublicSelect },
      },
    });

    if (!subscription) {
      throw new NotFoundException("Subscription not found");
    }

    return subscription;
  }

  async update(id: string, userId: string, dto: UpdateSubscriptionDto) {
    const existing = await this.findOne(id, userId);

    const nextPaymentDate =
      dto.nextPaymentDate !== undefined
        ? this.parseDate(dto.nextPaymentDate)
        : undefined;

    if (nextPaymentDate) {
      this.assertFutureDate(nextPaymentDate);
    }

    const nextPaymentMethod =
      dto.paymentMethod !== undefined
        ? normalizePaymentMethod(dto.paymentMethod)
        : existing.paymentMethod;
    const creditCardId = await this.creditCardsService.resolveLinkedCreditCardId(
      {
        userId,
        paymentMethod: nextPaymentMethod,
        creditCardId: dto.creditCardId,
        existingCreditCardId: existing.creditCardId ?? null,
      },
    );

    return this.prisma.subscription.update({
      where: { id },
      data: {
        name: dto.name,
        cost: dto.cost,
        paymentMethod: nextPaymentMethod,
        creditCardId,
        currency: dto.currency,
        billingCycle: dto.billingCycle as BillingCycle | undefined,
        nextPaymentDate,
        reminderDays: dto.reminderDays,
        isActive: dto.isActive,
        logoUrl: dto.logoUrl,
        hexColor: dto.hexColor,
      },
      include: {
        creditCard: { select: creditCardPublicSelect },
      },
    });
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id, userId);

    if (!existing.isActive) {
      return {
        message: "Subscription is already inactive",
        subscription: existing,
      };
    }

    const subscription = await this.prisma.subscription.update({
      where: { id },
      data: { isActive: false },
    });

    return {
      message: "Subscription deactivated successfully",
      subscription,
    };
  }

  async getMonthlyProjection(userId: string): Promise<MonthlyProjectionResult> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { userId, isActive: true },
      orderBy: { nextPaymentDate: "asc" },
    });

    const breakdownMap = new Map<string, number>();
    let totalMonthlyCost = 0;

    for (const subscription of subscriptions) {
      const monthlyCost =
        Number(subscription.cost) *
        this.getMonthlyFactor(subscription.billingCycle);
      totalMonthlyCost += monthlyCost;
      breakdownMap.set(
        subscription.currency,
        (breakdownMap.get(subscription.currency) ?? 0) + monthlyCost,
      );
    }

    const currencyBreakdown: ProjectionCurrencyItem[] = Array.from(
      breakdownMap.entries(),
    ).map(([currency, value]) => ({
      currency,
      monthlyCost: this.roundMoney(value),
    }));

    return {
      message: "Monthly subscription projection calculated successfully",
      activeCount: subscriptions.length,
      totalMonthlyCost: this.roundMoney(totalMonthlyCost),
      currency:
        currencyBreakdown.length === 1 ? currencyBreakdown[0].currency : null,
      currencyBreakdown,
    };
  }

  async findUpcoming(
    userId: string,
    days = 3,
  ): Promise<UpcomingSubscriptionItem[]> {
    const horizonDays = this.normalizeDays(days);
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + horizonDays);

    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        userId,
        isActive: true,
        nextPaymentDate: {
          gte: now,
          lte: endDate,
        },
      },
      select: {
        id: true,
        name: true,
        cost: true,
        currency: true,
        paymentMethod: true,
        creditCard: {
          select: creditCardPublicSelect,
        },
        nextPaymentDate: true,
      },
      orderBy: { nextPaymentDate: "asc" },
    });

    return subscriptions.map((subscription) => ({
      id: subscription.id,
      subscriptionId: subscription.id,
      name: subscription.name,
      amount: this.roundMoney(Number(subscription.cost)),
      currency: subscription.currency,
      daysRemaining: this.getDaysRemaining(now, subscription.nextPaymentDate),
      chargeDate: subscription.nextPaymentDate.toISOString(),
      nextPaymentDate: subscription.nextPaymentDate.toISOString(),
      paymentMethod: subscription.paymentMethod,
      creditCard: subscription.creditCard,
    }));
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
    return Math.round(value * 100) / 100;
  }

  private parseDate(raw: string) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException("Invalid nextPaymentDate");
    }
    return parsed;
  }

  private assertFutureDate(nextPaymentDate: Date) {
    if (nextPaymentDate <= new Date()) {
      throw new BadRequestException("nextPaymentDate must be in the future");
    }
  }

  private normalizeDays(days: number) {
    return Math.min(90, Math.max(1, Math.floor(days || 3)));
  }

  private getDaysRemaining(now: Date, nextPaymentDate: Date) {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const dueDay = new Date(nextPaymentDate);
    dueDay.setHours(0, 0, 0, 0);

    return Math.max(
      0,
      Math.floor(
        (dueDay.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000),
      ),
    );
  }

  private async sendImmediateSameDayReminderIfNeeded(
    subscription: SubscriptionReminderCandidate & { isActive?: boolean },
    now: Date,
  ) {
    if (!subscription.isActive) {
      return;
    }

    if (!this.isSameDay(subscription.nextPaymentDate, now)) {
      return;
    }

    if (!this.isPastReminderWindow(now)) {
      return;
    }

    await this.subscriptionsWorkerService.sendReminderForSubscription(
      {
        id: subscription.id,
        userId: subscription.userId,
        name: subscription.name,
        cost: subscription.cost,
        currency: subscription.currency,
        nextPaymentDate: subscription.nextPaymentDate,
        reminderDays: subscription.reminderDays,
        lastReminderSentFor: subscription.lastReminderSentFor ?? null,
      },
      now,
    );
  }

  private isSameDay(left: Date, right: Date) {
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  }

  private isPastReminderWindow(now: Date) {
    return now.getHours() >= 9;
  }
}
