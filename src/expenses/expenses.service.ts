import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { Prisma } from '@prisma/client';

type ExpenseWithCategory = Prisma.ExpenseGetPayload<{
  include: { category: true };
}>;

type ExpenseWithPresignedUrl = ExpenseWithCategory & {
  imagePresignedUrl?: string;
};

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
      orderBy: { date: 'desc' },
    });

    const total = expenses.reduce((sum, exp) => sum + Number(exp.cost), 0);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { dailyBudget: true },
    });

    return {
      expenses,
      total,
      dailyBudget: Number(user?.dailyBudget ?? 0),
      remaining: Number(user?.dailyBudget ?? 0) - total,
      percentage: user?.dailyBudget
        ? Math.round((total / Number(user.dailyBudget)) * 100)
        : 0,
    };
  }

  async findAll(userId: string, query: QueryExpenseDto) {
    const where: Prisma.ExpenseWhereInput = { userId };

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
      where.title = { contains: query.q, mode: 'insensitive' };
    }

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    const expenses = await this.prisma.expense.findMany({
      where,
      include: { category: true },
      orderBy: { date: 'desc' },
    });

    const total = expenses.reduce((sum, exp) => sum + Number(exp.cost), 0);

    return { expenses, total, count: expenses.length };
  }

  async findOne(id: string, userId: string): Promise<ExpenseWithPresignedUrl> {
    const expense = await this.prisma.expense.findFirst({
      where: { id, userId },
      include: { category: true },
    });

    if (!expense) throw new NotFoundException('Expense not found');

    if (expense.imageUrl) {
      try {
        const imagePresignedUrl = await this.storageService.getFileUrl(
          expense.imageUrl,
        );
        return { ...expense, imagePresignedUrl };
      } catch {
        // MinIO might not be available
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
        throw new NotFoundException('Category not found for this user');
      }

      nextCategoryId = category.id;
    }

    return this.prisma.expense.update({
      where: { id },
      data: {
        ...dto,
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
      } catch {
        // Best-effort image deletion
      }
    }

    return this.prisma.expense.delete({ where: { id } });
  }

  async syncBatch(userId: string, expenses: CreateExpenseDto[]) {
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
        throw new NotFoundException('Category not found for this user');
      }

      return category.id;
    }

    if (dto.categoryName) {
      const name = dto.categoryName.trim();
      if (!name) {
        throw new BadRequestException('categoryName cannot be empty');
      }

      const existing = await this.prisma.category.findFirst({
        where: {
          userId,
          name: { equals: name, mode: 'insensitive' },
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
      'A category is required. Send categoryId or categoryName.',
    );
  }
}
