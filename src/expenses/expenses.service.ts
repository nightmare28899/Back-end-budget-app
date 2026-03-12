import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { UpdateExpenseDto } from "./dto/update-expense.dto";
import { QueryExpenseDto } from "./dto/query-expense.dto";
import { PaymentMethod, Prisma } from "@prisma/client";
import {
  formatDateOnly,
  resolveBudgetWindow,
} from "../common/budget/budget.utils";

type ExpenseWithCategory = Prisma.ExpenseGetPayload<{
  include: { category: true };
}>;

type ExpenseWithPresignedUrl = ExpenseWithCategory & {
  imagePresignedUrl?: string;
};

const MAX_SYNC_BATCH_SIZE = 200;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async create(
    userId: string,
    dto: CreateExpenseDto,
    file?: Express.Multer.File,
  ) {
    let imageUrl: string | undefined;

    if (file) {
      imageUrl = await this.storageService.uploadFile(file);
    }

    const categoryId = await this.resolveCategoryId(userId, dto);

    return this.prisma.expense.create({
      data: {
        title: dto.title,
        cost: dto.cost,
        paymentMethod:
          (dto.paymentMethod as PaymentMethod | undefined) ??
          PaymentMethod.CASH,
        note: dto.note,
        date: dto.date ? new Date(dto.date) : new Date(),
        categoryId,
        imageUrl,
        userId,
      },
      include: { category: true },
    });
  }

  async findToday(userId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const expenses = await this.prisma.expense.findMany({
      where: {
        userId,
        date: { gte: startOfDay, lte: endOfDay },
      },
      include: { category: true },
      orderBy: { date: "desc" },
    });

    const total = expenses.reduce((sum, exp) => sum + Number(exp.cost), 0);

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

    const budgetWindow = resolveBudgetWindow({
      budgetAmount: user?.budgetAmount,
      dailyBudget: user?.dailyBudget,
      budgetPeriod: user?.budgetPeriod,
      budgetPeriodStart: user?.budgetPeriodStart,
      budgetPeriodEnd: user?.budgetPeriodEnd,
    });

    const aggregatedPeriodExpenses = await this.prisma.expense.aggregate({
      where: {
        userId,
        date: { gte: budgetWindow.start, lte: budgetWindow.end },
      },
      _sum: { cost: true },
    });

    const spentInBudgetPeriod = Number(aggregatedPeriodExpenses._sum.cost ?? 0);
    const remaining = budgetWindow.amount - spentInBudgetPeriod;
    const percentage =
      budgetWindow.amount > 0
        ? Math.round((spentInBudgetPeriod / budgetWindow.amount) * 100)
        : 0;

    return {
      expenses,
      total,
      dailyBudget: budgetWindow.amount,
      budgetAmount: budgetWindow.amount,
      budgetPeriod: budgetWindow.period,
      budgetPeriodStart: formatDateOnly(budgetWindow.start),
      budgetPeriodEnd: formatDateOnly(budgetWindow.end),
      spentInBudgetPeriod: Math.round(spentInBudgetPeriod * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      percentage,
    };
  }

  async findAll(userId: string, query: QueryExpenseDto) {
    const where: Prisma.ExpenseWhereInput = { userId };
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    if (query.from || query.to) {
      where.date = {};
      if (query.from) where.date.gte = new Date(query.from);
      if (query.to) {
        const toDate = new Date(query.to);
        toDate.setHours(23, 59, 59, 999);
        where.date.lte = toDate;
      }
    }

    if (query.q) {
      where.title = { contains: query.q, mode: "insensitive" };
    }

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    const [expenses, totalCount, sumResult] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: { category: true },
        orderBy: { date: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({
        where,
        _sum: { cost: true },
      }),
    ]);

    const total = Number(sumResult._sum.cost ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    return {
      expenses,
      total,
      count: expenses.length,
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

  async findOne(id: string, userId: string): Promise<ExpenseWithPresignedUrl> {
    const expense = await this.prisma.expense.findFirst({
      where: { id, userId },
      include: { category: true },
    });

    if (!expense) throw new NotFoundException("Expense not found");

    if (expense.imageUrl) {
      try {
        const imagePresignedUrl = await this.storageService.getFileUrl(
          expense.imageUrl,
        );
        return { ...expense, imagePresignedUrl };
      } catch (error) {
        console.error(error);
      }
    }

    return expense;
  }

  async update(id: string, userId: string, dto: UpdateExpenseDto) {
    await this.findOne(id, userId);

    let nextCategoryId = dto.categoryId;
    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, userId },
        select: { id: true },
      });

      if (!category) {
        throw new NotFoundException("Category not found for this user");
      }

      nextCategoryId = category.id;
    }

    return this.prisma.expense.update({
      where: { id },
      data: {
        ...dto,
        paymentMethod: dto.paymentMethod as PaymentMethod | undefined,
        categoryId: nextCategoryId,
        date: dto.date ? new Date(dto.date) : undefined,
      },
      include: { category: true },
    });
  }

  async remove(id: string, userId: string) {
    const expense = await this.findOne(id, userId);

    if (expense.imageUrl) {
      try {
        await this.storageService.deleteFile(expense.imageUrl);
      } catch (error) {
        console.error(error);
      }
    }

    return this.prisma.expense.delete({ where: { id } });
  }

  async syncBatch(userId: string, expenses: CreateExpenseDto[]) {
    if (!Array.isArray(expenses) || expenses.length === 0) {
      throw new BadRequestException("At least one expense is required");
    }

    if (expenses.length > MAX_SYNC_BATCH_SIZE) {
      throw new BadRequestException(
        `You can sync up to ${MAX_SYNC_BATCH_SIZE} expenses per request`,
      );
    }

    const results = [];
    for (const dto of expenses) {
      const expense = await this.create(userId, dto);
      results.push(expense);
    }
    return results;
  }

  private async resolveCategoryId(
    userId: string,
    dto: CreateExpenseDto,
  ): Promise<string> {
    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, userId },
        select: { id: true },
      });

      if (!category) {
        throw new NotFoundException("Category not found for this user");
      }

      return category.id;
    }

    if (dto.categoryName) {
      const name = dto.categoryName.trim();
      if (!name) {
        throw new BadRequestException("categoryName cannot be empty");
      }

      const existing = await this.prisma.category.findFirst({
        where: {
          userId,
          name: { equals: name, mode: "insensitive" },
        },
        select: { id: true },
      });

      if (existing) {
        return existing.id;
      }

      const created = await this.prisma.category.create({
        data: {
          userId,
          name,
          icon: dto.categoryIcon,
          color: dto.categoryColor,
        },
        select: { id: true },
      });

      return created.id;
    }

    throw new BadRequestException(
      "A category is required. Send categoryId or categoryName.",
    );
  }
}
