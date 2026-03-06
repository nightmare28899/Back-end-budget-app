import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getHistory(userId: string) {
    const [user, expenses, subscriptions] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          currency: true,
          dailyBudget: true,
          budgetAmount: true,
          budgetPeriod: true,
          budgetPeriodStart: true,
          budgetPeriodEnd: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.expense.findMany({
        where: { userId },
        include: { category: true },
        orderBy: { date: "desc" },
      }),
      this.prisma.subscription.findMany({
        where: { userId },
        orderBy: { nextPaymentDate: "asc" },
      }),
    ]);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const totalExpenses = expenses.reduce(
      (sum, expense) => sum + Number(expense.cost),
      0,
    );

    const activeSubscriptions = subscriptions.filter(
      (subscription) => subscription.isActive,
    );

    const currencyTotals = new Map<string, number>();
    let totalActiveSubscriptions = 0;

    for (const subscription of activeSubscriptions) {
      const amount = Number(subscription.cost);
      totalActiveSubscriptions += amount;
      currencyTotals.set(
        subscription.currency,
        (currencyTotals.get(subscription.currency) ?? 0) + amount,
      );
    }

    return {
      user,
      summary: {
        expenseCount: expenses.length,
        totalExpenses: this.roundMoney(totalExpenses),
        expenseCurrency: user.currency,
        subscriptionCount: subscriptions.length,
        activeSubscriptionCount: activeSubscriptions.length,
        totalActiveSubscriptions: this.roundMoney(totalActiveSubscriptions),
        subscriptionTotalsByCurrency: Array.from(currencyTotals.entries()).map(
          ([currency, total]) => ({
            currency,
            total: this.roundMoney(total),
          }),
        ),
      },
      expenses,
      subscriptions,
    };
  }

  private roundMoney(value: number) {
    return Math.round(value * 100) / 100;
  }
}
