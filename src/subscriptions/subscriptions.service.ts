import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { BillingCycle } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSubscriptionDto } from "./dto/create-subscription.dto";
import { UpdateSubscriptionDto } from "./dto/update-subscription.dto";

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
  name: string;
  amount: number;
  daysRemaining: number;
}

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateSubscriptionDto) {
    const nextPaymentDate = this.parseDate(dto.nextPaymentDate);
    this.assertFutureDate(nextPaymentDate);

    return this.prisma.subscription.create({
      data: {
        userId,
        name: dto.name,
        cost: dto.cost,
        currency: dto.currency ?? "MXN",
        billingCycle: dto.billingCycle as BillingCycle,
        nextPaymentDate,
        reminderDays: dto.reminderDays ?? 3,
        isActive: dto.isActive ?? true,
        logoUrl: dto.logoUrl,
        hexColor: dto.hexColor,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId },
      orderBy: { nextPaymentDate: "asc" },
    });
  }

  async findOne(id: string, userId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id, userId },
    });

    if (!subscription) {
      throw new NotFoundException("Subscription not found");
    }

    return subscription;
  }

  async update(id: string, userId: string, dto: UpdateSubscriptionDto) {
    await this.findOne(id, userId);

    const nextPaymentDate =
      dto.nextPaymentDate !== undefined
        ? this.parseDate(dto.nextPaymentDate)
        : undefined;

    if (nextPaymentDate) {
      this.assertFutureDate(nextPaymentDate);
    }

    return this.prisma.subscription.update({
      where: { id },
      data: {
        name: dto.name,
        cost: dto.cost,
        currency: dto.currency,
        billingCycle: dto.billingCycle as BillingCycle | undefined,
        nextPaymentDate,
        reminderDays: dto.reminderDays,
        isActive: dto.isActive,
        logoUrl: dto.logoUrl,
        hexColor: dto.hexColor,
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
      currency: currencyBreakdown.length === 1 ? currencyBreakdown[0].currency : null,
      currencyBreakdown,
    };
  }

  async findUpcoming(userId: string, days = 3): Promise<UpcomingSubscriptionItem[]> {
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
        name: true,
        cost: true,
        nextPaymentDate: true,
      },
      orderBy: { nextPaymentDate: "asc" },
    });

    return subscriptions.map((subscription) => ({
      name: subscription.name,
      amount: this.roundMoney(Number(subscription.cost)),
      daysRemaining: this.getDaysRemaining(now, subscription.nextPaymentDate),
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
}
