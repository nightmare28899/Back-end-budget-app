import {
  BadRequestException,
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

  async createGoal(
    userId: string,
    data: {
      title: string;
      targetAmount: number;
      targetDate?: string;
      icon?: string;
      color?: string;
    },
  ) {
    try {
      return await this.prisma.savingsGoal.create({
        data: {
          userId,
          title: data.title,
          targetAmount: this.toDecimal(data.targetAmount),
          currentAmount: this.toDecimal(0),
          ...(data.targetDate ? { targetDate: new Date(data.targetDate) } : {}),
          ...(data.icon !== undefined ? { icon: data.icon } : {}),
          ...(data.color !== undefined ? { color: data.color } : {}),
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

  async withdrawFunds(userId: string, goalId: string, amount: number) {
    try {
      const goal = await this.prisma.savingsGoal.findFirst({
        where: { id: goalId, userId },
        select: { id: true, currentAmount: true },
      });

      if (!goal) {
        throw new NotFoundException("Savings goal not found");
      }

      const decimalAmount = this.toDecimal(amount);
      const currentAmount = new Prisma.Decimal(goal.currentAmount);

      if (currentAmount.lessThan(decimalAmount)) {
        throw new BadRequestException(
          "Insufficient savings balance for this withdrawal",
        );
      }

      return await this.prisma.$transaction(async (tx) => {
        const withdrawal = await tx.savingsTransaction.create({
          data: {
            amount: decimalAmount,
            type: SavingsTransactionType.WITHDRAW,
            goalId,
          },
        });

        const updatedGoal = await tx.savingsGoal.update({
          where: { id: goalId },
          data: {
            currentAmount: {
              decrement: decimalAmount,
            },
          },
        });

        return { withdrawal, goal: updatedGoal };
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException("Could not process withdrawal");
    }
  }

  async updateGoal(
    userId: string,
    goalId: string,
    data: {
      title?: string;
      targetAmount?: number;
      targetDate?: string;
      icon?: string;
      color?: string;
    },
  ) {
    const goal = await this.prisma.savingsGoal.findFirst({
      where: { id: goalId, userId },
      select: { id: true, currentAmount: true },
    });

    if (!goal) {
      throw new NotFoundException("Savings goal not found");
    }

    if (
      data.targetAmount !== undefined &&
      new Prisma.Decimal(data.targetAmount).lessThan(goal.currentAmount)
    ) {
      throw new BadRequestException(
        "Target amount cannot be lower than current saved amount",
      );
    }

    try {
      return await this.prisma.savingsGoal.update({
        where: { id: goalId },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.targetAmount !== undefined
            ? { targetAmount: this.toDecimal(data.targetAmount) }
            : {}),
          ...(data.targetDate !== undefined
            ? { targetDate: data.targetDate ? new Date(data.targetDate) : null }
            : {}),
          ...(data.icon !== undefined ? { icon: data.icon || null } : {}),
          ...(data.color !== undefined ? { color: data.color || null } : {}),
        },
      });
    } catch {
      throw new InternalServerErrorException("Could not update savings goal");
    }
  }

  async deleteGoal(userId: string, goalId: string) {
    const goal = await this.prisma.savingsGoal.findFirst({
      where: { id: goalId, userId },
      select: { id: true, currentAmount: true },
    });

    if (!goal) {
      throw new NotFoundException("Savings goal not found");
    }

    if (!new Prisma.Decimal(goal.currentAmount).equals(0)) {
      throw new BadRequestException(
        "Savings goal can only be deleted when current amount is 0",
      );
    }

    try {
      await this.prisma.savingsGoal.delete({ where: { id: goalId } });
      return { success: true };
    } catch {
      throw new InternalServerErrorException("Could not delete savings goal");
    }
  }

  private toDecimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value);
  }
}
