import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { BillingCycle, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

interface ProcessSubscriptionsResultItem {
  subscriptionId: string;
  name: string;
  expensesCreated: number;
  nextPaymentDate: Date;
}

export interface ProcessSubscriptionsResult {
  processedCount: number;
  results: ProcessSubscriptionsResultItem[];
}

interface SubscriptionReminderResultItem {
  subscriptionId: string;
  name: string;
  nextPaymentDate: Date;
  daysRemaining: number;
  successCount: number;
}

export interface SubscriptionReminderRunResult {
  processedCount: number;
  results: SubscriptionReminderResultItem[];
}

export interface SubscriptionReminderCandidate {
  id: string;
  userId: string;
  name: string;
  cost: Prisma.Decimal | number;
  currency: string;
  nextPaymentDate: Date;
  reminderDays: number;
  lastReminderSentFor: Date | null;
}

@Injectable()
export class SubscriptionsWorkerService {
  private readonly logger = new Logger(SubscriptionsWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron("1 0 * * *")
  async processSubscriptionsCron() {
    this.logger.log("Running process_subscriptions job");
    const result = await this.processDueSubscriptions();
    this.logger.log(
      `process_subscriptions finished: ${result.processedCount} subscriptions processed`,
    );
  }

  @Cron("0 9 * * *")
  async sendSubscriptionRemindersCron() {
    this.logger.log("Running send_subscription_reminders job");

    try {
      const result = await this.processUpcomingReminders();
      this.logger.log(
        `send_subscription_reminders finished: ${result.processedCount} reminders delivered`,
      );
    } catch (error) {
      this.logger.error(
        "send_subscription_reminders failed",
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async processDueSubscriptions(
    now = new Date(),
    userId?: string,
  ): Promise<ProcessSubscriptionsResult> {
    const where: Prisma.SubscriptionWhereInput = {
      isActive: true,
      nextPaymentDate: { lte: now },
      ...(userId ? { userId } : {}),
    };

    const dueSubscriptions = await this.prisma.subscription.findMany({
      where,
      orderBy: { nextPaymentDate: "asc" },
    });

    const results: ProcessSubscriptionsResultItem[] = [];

    for (const subscription of dueSubscriptions) {
      const dueDates = this.getDuePaymentDates(
        subscription.nextPaymentDate,
        now,
        subscription.billingCycle,
      );

      if (dueDates.length === 0) {
        continue;
      }

      const nextPaymentDate = this.addInterval(
        dueDates[dueDates.length - 1],
        subscription.billingCycle,
      );

      await this.prisma.$transaction(async (tx) => {
        await tx.expense.createMany({
          data: dueDates.map((dueDate) => ({
            userId: subscription.userId,
            title: `${subscription.name} subscription`,
            cost: subscription.cost,
            currency: subscription.currency,
            paymentMethod: subscription.paymentMethod,
            creditCardId: subscription.creditCardId,
            date: dueDate,
            note: `Auto-generated from subscription ${subscription.name}`,
            isSubscription: true,
            subscriptionId: subscription.id,
          })),
        });

        await tx.subscription.update({
          where: { id: subscription.id },
          data: { nextPaymentDate },
        });
      });

      results.push({
        subscriptionId: subscription.id,
        name: subscription.name,
        expensesCreated: dueDates.length,
        nextPaymentDate,
      });
    }

    return {
      processedCount: results.length,
      results,
    };
  }

  async processUpcomingReminders(
    now = new Date(),
    userId?: string,
  ): Promise<SubscriptionReminderRunResult> {
    const startDate = this.startOfDay(now);
    const endDate = this.startOfDay(now);
    endDate.setDate(endDate.getDate() + 30);

    const where: Prisma.SubscriptionWhereInput = {
      isActive: true,
      nextPaymentDate: {
        gte: startDate,
        lte: endDate,
      },
      ...(userId ? { userId } : {}),
    };

    const subscriptions = await this.prisma.subscription.findMany({
      where,
      select: {
        id: true,
        userId: true,
        name: true,
        cost: true,
        currency: true,
        nextPaymentDate: true,
        reminderDays: true,
        lastReminderSentFor: true,
      },
      orderBy: { nextPaymentDate: "asc" },
    });

    const results: SubscriptionReminderResultItem[] = [];

    for (const subscription of subscriptions) {
      const result = await this.sendReminderForSubscription(subscription, now);
      if (result) {
        results.push(result);
      }
    }

    return {
      processedCount: results.length,
      results,
    };
  }

  async sendReminderForSubscription(
    subscription: SubscriptionReminderCandidate,
    now = new Date(),
  ): Promise<SubscriptionReminderResultItem | null> {
    const daysRemaining = this.getDaysRemaining(now, subscription.nextPaymentDate);
    if (daysRemaining < 0 || daysRemaining > subscription.reminderDays) {
      return null;
    }

    if (
      subscription.lastReminderSentFor &&
      subscription.lastReminderSentFor.getTime() ===
        subscription.nextPaymentDate.getTime()
    ) {
      return null;
    }

    try {
      const pushResult = await this.notificationsService.sendSubscriptionReminder(
        {
          id: subscription.id,
          userId: subscription.userId,
          name: subscription.name,
          cost: subscription.cost,
          currency: subscription.currency,
          nextPaymentDate: subscription.nextPaymentDate,
          daysRemaining,
        },
      );

      if (pushResult.successCount <= 0) {
        return null;
      }

      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          lastReminderSentFor: subscription.nextPaymentDate,
        },
      });

      return {
        subscriptionId: subscription.id,
        name: subscription.name,
        nextPaymentDate: subscription.nextPaymentDate,
        daysRemaining,
        successCount: pushResult.successCount,
      };
    } catch (error) {
      this.logger.warn(
        `Skipping reminder for subscription ${subscription.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private getDuePaymentDates(
    firstDueDate: Date,
    now: Date,
    cycle: BillingCycle,
  ): Date[] {
    const dueDates: Date[] = [];
    let cursor = new Date(firstDueDate);

    while (cursor <= now) {
      dueDates.push(new Date(cursor));
      cursor = this.addInterval(cursor, cycle);
    }

    return dueDates;
  }

  private addInterval(date: Date, cycle: BillingCycle): Date {
    const next = new Date(date);

    switch (cycle) {
      case BillingCycle.DAILY:
        next.setDate(next.getDate() + 1);
        break;
      case BillingCycle.WEEKLY:
        next.setDate(next.getDate() + 7);
        break;
      case BillingCycle.YEARLY:
        next.setFullYear(next.getFullYear() + 1);
        break;
      case BillingCycle.MONTHLY:
      default:
        next.setMonth(next.getMonth() + 1);
        break;
    }

    return next;
  }

  private startOfDay(date: Date): Date {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
  }

  private getDaysRemaining(now: Date, targetDate: Date): number {
    const startNow = this.startOfDay(now).getTime();
    const startTarget = this.startOfDay(targetDate).getTime();
    return Math.round((startTarget - startNow) / 86_400_000);
  }
}
