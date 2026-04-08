import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  formatDateOnly,
  resolveBudgetWindow,
} from "../common/budget/budget.utils";
import { CreateIncomeDto } from "./dto/create-income.dto";
import { UpdateIncomeDto } from "./dto/update-income.dto";
import { QueryIncomeDto } from "./dto/query-income.dto";

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

@Injectable()
export class IncomesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateIncomeDto) {
    const currency = dto.currency ?? (await this.getUserCurrency(userId));

    return this.prisma.income.create({
      data: {
        title: dto.title.trim(),
        amount: dto.amount,
        currency,
        note: dto.note?.trim() || null,
        date: dto.date ? new Date(dto.date) : new Date(),
        userId,
      },
    });
  }

  async findAll(userId: string, query: QueryIncomeDto) {
    const where: Prisma.IncomeWhereInput = { userId };

    if (query.from || query.to) {
      const dateFilter: Prisma.DateTimeFilter = {};

      if (query.from) {
        dateFilter.gte = new Date(query.from);
      }

      if (query.to) {
        dateFilter.lte = endOfDay(new Date(query.to));
      }

      where.date = dateFilter;
    }

    if (query.q?.trim()) {
      where.OR = [
        {
          title: {
            contains: query.q.trim(),
            mode: "insensitive",
          },
        },
        {
          note: {
            contains: query.q.trim(),
            mode: "insensitive",
          },
        },
      ];
    }

    const [incomes, sumResult, currencyGroups] = await Promise.all([
      this.prisma.income.findMany({
        where,
        orderBy: { date: "desc" },
      }),
      this.prisma.income.aggregate({
        where,
        _sum: { amount: true },
      }),
      this.prisma.income.groupBy({
        by: ["currency"],
        where,
        _sum: { amount: true },
      }),
    ]);

    return {
      incomes,
      total: roundMoney(Number(sumResult._sum.amount ?? 0)),
      count: incomes.length,
      currencyBreakdown: currencyGroups.map((item) => ({
        currency: item.currency,
        total: roundMoney(Number(item._sum.amount ?? 0)),
      })),
    };
  }

  async getSummary(userId: string, referenceDate?: string) {
    const now = referenceDate ? new Date(referenceDate) : new Date();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        dailyBudget: true,
        budgetAmount: true,
        budgetPeriod: true,
        budgetPeriodStart: true,
        budgetPeriodEnd: true,
      },
    });

    const budgetWindow = resolveBudgetWindow(
      {
        budgetAmount: user?.budgetAmount,
        dailyBudget: user?.dailyBudget,
        budgetPeriod: user?.budgetPeriod,
        budgetPeriodStart: user?.budgetPeriodStart,
        budgetPeriodEnd: user?.budgetPeriodEnd,
      },
      now,
    );
    const trackedEnd =
      endOfDay(now) < budgetWindow.end ? endOfDay(now) : budgetWindow.end;

    const where = {
      userId,
      date: {
        gte: budgetWindow.start,
        lte: trackedEnd,
      },
    } satisfies Prisma.IncomeWhereInput;

    const [incomeAgg, incomeCount, expenseAgg] = await Promise.all([
      this.prisma.income.aggregate({
        where,
        _sum: { amount: true },
      }),
      this.prisma.income.count({ where }),
      this.prisma.expense.aggregate({
        where: {
          userId,
          date: {
            gte: budgetWindow.start,
            lte: trackedEnd,
          },
        },
        _sum: { cost: true },
      }),
    ]);

    const totalIncome = roundMoney(Number(incomeAgg._sum.amount ?? 0));
    const totalExpenses = roundMoney(Number(expenseAgg._sum.cost ?? 0));
    const net = roundMoney(totalIncome - totalExpenses);

    return {
      period: {
        type: budgetWindow.period,
        start: formatDateOnly(budgetWindow.start),
        end: formatDateOnly(trackedEnd),
      },
      totalIncome,
      totalExpenses,
      net,
      incomeCount,
      averageIncome:
        incomeCount > 0 ? roundMoney(totalIncome / incomeCount) : 0,
      savingsRate:
        totalIncome > 0 ? roundPercent((net / totalIncome) * 100) : null,
    };
  }

  async update(id: string, userId: string, dto: UpdateIncomeDto) {
    await this.assertExists(id, userId);

    const data: Prisma.IncomeUpdateInput = {};
    if (dto.title !== undefined) {
      data.title = dto.title.trim();
    }
    if (dto.amount !== undefined) {
      data.amount = dto.amount;
    }
    if (dto.currency !== undefined) {
      data.currency = dto.currency;
    }
    if (dto.note !== undefined) {
      data.note = dto.note?.trim() || null;
    }
    if (dto.date !== undefined) {
      data.date = new Date(dto.date);
    }

    return this.prisma.income.update({
      where: { id },
      data,
    });
  }

  async remove(id: string, userId: string) {
    await this.assertExists(id, userId);

    await this.prisma.income.delete({
      where: { id },
    });

    return { success: true };
  }

  private async assertExists(id: string, userId: string) {
    const income = await this.prisma.income.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!income) {
      throw new NotFoundException("Income record not found");
    }
  }

  private async getUserCurrency(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { currency: true },
    });

    return user?.currency || "MXN";
  }
}
