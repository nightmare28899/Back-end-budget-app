import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, SavingsTransactionType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SavingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSavingsGoals(userId: string) {
    try {
      return await this.prisma.savingsGoal.findMany({
        where: { userId },
        include: {
          transactions: {
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
        orderBy: { createdAt: "desc" },
      });
    } catch {
      throw new InternalServerErrorException("Could not fetch savings goals");
    }
  }

  async createGoal(userId: string, title: string, targetAmount: number) {
    try {
      return await this.prisma.savingsGoal.create({
        data: {
          userId,
          title,
          targetAmount: this.toDecimal(targetAmount),
          currentAmount: this.toDecimal(0),
        },
      });
    } catch {
      throw new InternalServerErrorException("Could not create savings goal");
    }
  }

  async addFunds(userId: string, goalId: string, amount: number) {
    try {
      const goal = await this.prisma.savingsGoal.findFirst({
        where: { id: goalId, userId },
        select: { id: true },
      });

      if (!goal) {
        throw new NotFoundException("Savings goal not found");
      }

      const decimalAmount = this.toDecimal(amount);

      return await this.prisma.$transaction(async (tx) => {
        const deposit = await tx.savingsTransaction.create({
          data: {
            amount: decimalAmount,
            type: SavingsTransactionType.DEPOSIT,
            goalId,
          },
        });

        const updatedGoal = await tx.savingsGoal.update({
          where: { id: goalId },
          data: {
            currentAmount: {
              increment: decimalAmount,
            },
          },
        });

        return { deposit, goal: updatedGoal };
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException("Could not process deposit");
    }
  }

  async getGoalTransactions(userId: string, goalId: string) {
    const goal = await this.prisma.savingsGoal.findFirst({
      where: { id: goalId, userId },
      select: { id: true },
    });

    if (!goal) {
      throw new NotFoundException("Savings goal not found");
    }

    try {
      return await this.prisma.savingsTransaction.findMany({
        where: { goalId },
        orderBy: { createdAt: "desc" },
      });
    } catch {
      throw new InternalServerErrorException(
        "Could not fetch savings transactions",
      );
    }
  }

  private toDecimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value);
  }
}
