import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { BillingCycle, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

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

@Injectable()
export class SubscriptionsWorkerService {
  private readonly logger = new Logger(SubscriptionsWorkerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron("1 0 * * *")
  async processSubscriptionsCron() {
    this.logger.log("Running process_subscriptions job");
    const result = await this.processDueSubscriptions();
    this.logger.log(
      `process_subscriptions finished: ${result.processedCount} subscriptions processed`,
    );
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
}
