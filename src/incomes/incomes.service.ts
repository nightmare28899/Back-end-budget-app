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

    if (query.page !== undefined) {
      return this.findPage(where, query.page, query.limit ?? 20);
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

  private async findPage(
    where: Prisma.IncomeWhereInput,
    page: number,
    limit: number,
  ) {
    const [incomes, totalCount, sumResult, currencyGroups] = await Promise.all([
      this.prisma.income.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.income.count({ where }),
      this.prisma.income.aggregate({ where, _sum: { amount: true } }),
      this.prisma.income.groupBy({
        by: ["currency"],
        where,
        _sum: { amount: true },
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    return {
      incomes,
      total: roundMoney(Number(sumResult._sum.amount ?? 0)),
      count: incomes.length,
      currencyBreakdown: currencyGroups.map((item) => ({
        currency: item.currency,
        total: roundMoney(Number(item._sum.amount ?? 0)),
      })),
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async getSummary(userId: string, referenceDate?: string, currency?: string) {
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

    const dateRange = { gte: budgetWindow.start, lte: trackedEnd };
    const where = {
      userId,
      date: dateRange,
      ...(currency ? { currency } : {}),
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
          date: dateRange,
          ...(currency ? { currency } : {}),
        },
        _sum: { cost: true },
      }),
    ]);

    const totalIncome = roundMoney(Number(incomeAgg._sum.amount ?? 0));
    const totalExpenses = roundMoney(Number(expenseAgg._sum.cost ?? 0));
    const net = roundMoney(totalIncome - totalExpenses);

    const otherCurrencies = currency
      ? await this.getOtherCurrencyTotals(userId, dateRange, currency)
      : undefined;

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
      ...(currency ? { currency, otherCurrencies } : {}),
    };
  }

  /** Per-currency totals for currencies other than `currency`; never summed together. */
  private async getOtherCurrencyTotals(
    userId: string,
    date: Prisma.DateTimeFilter,
    currency: string,
  ) {
    const filter = { userId, date, currency: { not: currency } };
    const [incomeGroups, expenseGroups] = await Promise.all([
      this.prisma.income.groupBy({
        by: ["currency"],
        where: filter,
        _sum: { amount: true },
      }),
      this.prisma.expense.groupBy({
        by: ["currency"],
        where: filter,
        _sum: { cost: true },
      }),
    ]);

    const totals = new Map<
      string,
      { currency: string; totalIncome: number; totalExpenses: number }
    >();
    const entry = (code: string) => {
      let item = totals.get(code);
      if (!item) {
        item = { currency: code, totalIncome: 0, totalExpenses: 0 };
        totals.set(code, item);
      }
      return item;
    };
    for (const group of incomeGroups) {
      entry(group.currency).totalIncome = roundMoney(
        Number(group._sum.amount ?? 0),
      );
    }
    for (const group of expenseGroups) {
      entry(group.currency).totalExpenses = roundMoney(
        Number(group._sum.cost ?? 0),
      );
    }

    return [...totals.values()]
      .filter((item) => item.totalIncome !== 0 || item.totalExpenses !== 0)
      .sort((a, b) => a.currency.localeCompare(b.currency));
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
