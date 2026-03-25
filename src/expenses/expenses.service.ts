import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { UpdateExpenseDto } from "./dto/update-expense.dto";
import { QueryExpenseDto } from "./dto/query-expense.dto";
import { InstallmentFrequency, PaymentMethod, Prisma } from "@prisma/client";
import {
  formatDateOnly,
  resolveBudgetWindow,
} from "../common/budget/budget.utils";
import { CreditCardsService } from "../credit-cards/credit-cards.service";
import { creditCardPublicSelect } from "../credit-cards/credit-card.select";
import { normalizePaymentMethod } from "../common/payments/payment-method.utils";
import {
  buildInstallmentSchedule,
  InstallmentFrequencyValue,
} from "./installments/expense-installments.util";

type ExpenseWithCategory = Prisma.ExpenseGetPayload<{
  include: {
    category: true;
    creditCard: { select: typeof creditCardPublicSelect };
  };
}>;

type ExpenseWithPresignedUrl = ExpenseWithCategory & {
  imagePresignedUrl?: string;
};

const MAX_SYNC_BATCH_SIZE = 200;
const DEFAULT_EXPENSE_CURRENCY = "MXN";
const DEFAULT_INSTALLMENT_FREQUENCY = InstallmentFrequency.MONTHLY;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly creditCardsService: CreditCardsService,
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
    const currency = dto.currency ?? (await this.getUserCurrency(userId));
    const paymentMethod =
      normalizePaymentMethod(dto.paymentMethod) ?? PaymentMethod.CASH;
    const creditCardId = await this.creditCardsService.resolveLinkedCreditCardId(
      {
        userId,
        paymentMethod,
        creditCardId: dto.creditCardId,
      },
    );

    const installmentPlan = this.buildInstallmentPlan(dto);
    if (installmentPlan) {
      return this.createInstallmentExpenses({
        userId,
        dto,
        imageUrl,
        categoryId,
        currency,
        paymentMethod,
        creditCardId,
        installmentPlan,
      });
    }

    return this.prisma.expense.create({
      data: {
        title: dto.title,
        cost: dto.cost,
        currency,
        paymentMethod,
        creditCardId,
        note: dto.note,
        date: dto.date ? new Date(dto.date) : new Date(),
        categoryId,
        imageUrl,
        userId,
      },
      include: {
        category: true,
        creditCard: { select: creditCardPublicSelect },
      },
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
      include: {
        category: true,
        creditCard: { select: creditCardPublicSelect },
      },
      orderBy: { date: "desc" },
    });

    const total = expenses.reduce((sum, exp) => sum + Number(exp.cost), 0);
    const currencyBreakdown = this.buildCurrencyBreakdownFromExpenses(expenses);

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
      currency:
        currencyBreakdown.length === 1 ? currencyBreakdown[0].currency : null,
      currencyBreakdown,
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

    const [expenses, totalCount, sumResult, currencyGroups] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: {
          category: true,
          creditCard: { select: creditCardPublicSelect },
        },
        orderBy: { date: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({
        where,
        _sum: { cost: true },
      }),
      this.prisma.expense.groupBy({
        by: ["currency"],
        where,
        _sum: { cost: true },
      }),
    ]);

    const total = Number(sumResult._sum.cost ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const currencyBreakdown = currencyGroups.map((item) => ({
      currency: item.currency,
      total: this.roundMoney(Number(item._sum.cost ?? 0)),
    }));

    return {
      expenses,
      total,
      currencyBreakdown,
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
      include: {
        category: true,
        creditCard: { select: creditCardPublicSelect },
      },
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
    const existing = await this.findOne(id, userId);

    const nextCategoryId =
      dto.categoryId !== undefined
        ? await this.resolveExistingCategoryId(userId, dto.categoryId)
        : existing.categoryId;

    const nextPaymentMethod =
      dto.paymentMethod !== undefined
        ? normalizePaymentMethod(dto.paymentMethod) ?? PaymentMethod.CASH
        : existing.paymentMethod;
    const creditCardId = await this.creditCardsService.resolveLinkedCreditCardId(
      {
        userId,
        paymentMethod: nextPaymentMethod,
        creditCardId: dto.creditCardId,
        existingCreditCardId: existing.creditCardId ?? null,
      },
    );

    const nextCurrency = dto.currency ?? existing.currency;
    const shouldUseInstallmentPlan = dto.isInstallment ?? existing.isInstallment;
    if (shouldUseInstallmentPlan) {
      const installmentPlan = this.buildInstallmentPlan(dto, {
        totalAmount:
          dto.cost ??
          Number(existing.installmentTotalAmount ?? existing.cost),
        installmentCount: dto.installmentCount ?? existing.installmentCount ?? 0,
        frequency:
          (dto.installmentFrequency as InstallmentFrequencyValue | undefined) ??
          (existing.installmentFrequency as InstallmentFrequencyValue | null) ??
          DEFAULT_INSTALLMENT_FREQUENCY,
        purchaseDate:
          dto.installmentPurchaseDate !== undefined
            ? new Date(dto.installmentPurchaseDate)
            : existing.installmentPurchaseDate ?? existing.date,
        firstPaymentDate:
          dto.installmentFirstPaymentDate !== undefined
            ? new Date(dto.installmentFirstPaymentDate)
            : existing.installmentFirstPaymentDate ?? existing.date,
      });
      if (!installmentPlan) {
        throw new BadRequestException("Installment configuration is invalid");
      }

      return this.replaceInstallmentExpenses({
        userId,
        dto,
        existing,
        categoryId: nextCategoryId ?? null,
        currency: nextCurrency,
        paymentMethod: nextPaymentMethod,
        creditCardId,
        installmentPlan,
      });
    }

    if (existing.isInstallment) {
      return this.replaceInstallmentPlanWithSingleExpense({
        userId,
        dto,
        existing,
        categoryId: nextCategoryId ?? null,
        currency: nextCurrency,
        paymentMethod: nextPaymentMethod,
        creditCardId,
      });
    }

    return this.prisma.expense.update({
      where: { id },
      data: {
        ...dto,
        isInstallment: false,
        installmentGroupId: null,
        installmentCount: null,
        installmentIndex: null,
        installmentTotalAmount: null,
        installmentFrequency: null,
        installmentPurchaseDate: null,
        installmentFirstPaymentDate: null,
        currency: nextCurrency,
        paymentMethod: nextPaymentMethod,
        creditCardId,
        categoryId: nextCategoryId,
        date: dto.date ? new Date(dto.date) : undefined,
      },
      include: {
        category: true,
        creditCard: { select: creditCardPublicSelect },
      },
    });
  }

  async remove(id: string, userId: string) {
    const expense = await this.findOne(id, userId);

    if (!expense.isInstallment) {
      if (expense.imageUrl) {
        try {
          await this.storageService.deleteFile(expense.imageUrl);
        } catch (error) {
          console.error(error);
        }
      }

      return this.prisma.expense.delete({ where: { id } });
    }

    const installmentGroupId = expense.installmentGroupId ?? expense.id;
    const groupedExpenses = await this.prisma.expense.findMany({
      where: {
        userId,
        OR: [{ id }, { installmentGroupId }],
      },
      select: { id: true, imageUrl: true },
    });

    const imageUrls = Array.from(
      new Set(
        groupedExpenses
          .map((item) => item.imageUrl)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    for (const imageUrl of imageUrls) {
      try {
        await this.storageService.deleteFile(imageUrl);
      } catch (error) {
        console.error(error);
      }
    }

    await this.prisma.expense.deleteMany({
      where: {
        userId,
        OR: [{ id }, { installmentGroupId }],
      },
    });

    return {
      deletedCount: groupedExpenses.length,
      deletedExpenseIds: groupedExpenses.map((item) => item.id),
      installmentGroupId,
    };
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

  private buildInstallmentPlan(
    dto: {
      isInstallment?: boolean;
      cost?: number;
      installmentCount?: number;
      installmentFrequency?: string;
      installmentPurchaseDate?: string;
      installmentFirstPaymentDate?: string;
    },
    fallback?: {
      totalAmount: number;
      installmentCount: number;
      frequency: InstallmentFrequencyValue | InstallmentFrequency;
      purchaseDate: Date;
      firstPaymentDate: Date;
    },
  ) {
    const isInstallment = dto.isInstallment ?? Boolean(fallback);
    if (!isInstallment) {
      return null;
    }

    const totalAmount = dto.cost ?? fallback?.totalAmount;
    const installmentCount = dto.installmentCount ?? fallback?.installmentCount;
    const frequency =
      (dto.installmentFrequency as InstallmentFrequencyValue | undefined) ??
      fallback?.frequency ??
      DEFAULT_INSTALLMENT_FREQUENCY;
    const firstPaymentDate = dto.installmentFirstPaymentDate
      ? new Date(dto.installmentFirstPaymentDate)
      : fallback?.firstPaymentDate;
    const purchaseDate = dto.installmentPurchaseDate
      ? new Date(dto.installmentPurchaseDate)
      : fallback?.purchaseDate ?? firstPaymentDate;

    if (
      totalAmount == null ||
      !Number.isFinite(totalAmount) ||
      totalAmount <= 0
    ) {
      throw new BadRequestException(
        "A valid total amount is required for installment expenses",
      );
    }
    const normalizedTotalAmount = Number(totalAmount);

    if (
      installmentCount == null ||
      !Number.isFinite(installmentCount) ||
      installmentCount <= 1
    ) {
      throw new BadRequestException(
        "installmentCount is required and must be greater than 1",
      );
    }

    const normalizedInstallmentCount = Math.trunc(Number(installmentCount));

    if (!firstPaymentDate || Number.isNaN(firstPaymentDate.getTime())) {
      throw new BadRequestException(
        "installmentFirstPaymentDate is required when isInstallment is true",
      );
    }

    if (!purchaseDate || Number.isNaN(purchaseDate.getTime())) {
      throw new BadRequestException(
        "installmentPurchaseDate is invalid",
      );
    }

    if (firstPaymentDate < purchaseDate) {
      throw new BadRequestException(
        "installmentFirstPaymentDate must be on or after installmentPurchaseDate",
      );
    }

    const normalizedFrequency =
      frequency === InstallmentFrequency.MONTHLY || frequency === "MONTHLY"
        ? InstallmentFrequency.MONTHLY
        : DEFAULT_INSTALLMENT_FREQUENCY;

    return {
      totalAmount: normalizedTotalAmount,
      installmentCount: normalizedInstallmentCount,
      frequency: normalizedFrequency,
      purchaseDate,
      firstPaymentDate,
      schedule: buildInstallmentSchedule({
        totalAmount: normalizedTotalAmount,
        installmentCount: normalizedInstallmentCount,
        firstPaymentDate,
      }),
    };
  }

  private async createInstallmentExpenses(input: {
    userId: string;
    dto: CreateExpenseDto;
    imageUrl?: string;
    categoryId: string;
    currency: string;
    paymentMethod: PaymentMethod;
    creditCardId: string | null;
    installmentPlan: NonNullable<ReturnType<ExpensesService["buildInstallmentPlan"]>>;
  }) {
    const installmentGroupId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const createdExpenses: ExpenseWithCategory[] = [];

      for (const scheduleItem of input.installmentPlan.schedule) {
        const created = await tx.expense.create({
          data: {
            title: input.dto.title,
            cost: scheduleItem.amount,
            currency: input.currency,
            paymentMethod: input.paymentMethod,
            creditCardId: input.creditCardId,
            note: input.dto.note,
            date: scheduleItem.paymentDate,
            categoryId: input.categoryId,
            imageUrl: input.imageUrl,
            userId: input.userId,
            isInstallment: true,
            installmentGroupId,
            installmentCount: input.installmentPlan.installmentCount,
            installmentIndex: scheduleItem.installmentIndex,
            installmentTotalAmount: input.installmentPlan.totalAmount,
            installmentFrequency: input.installmentPlan.frequency,
            installmentPurchaseDate: input.installmentPlan.purchaseDate,
            installmentFirstPaymentDate: input.installmentPlan.firstPaymentDate,
          },
          include: {
            category: true,
            creditCard: { select: creditCardPublicSelect },
          },
        });

        createdExpenses.push(created);
      }

      return createdExpenses[0];
    });
  }

  private async replaceInstallmentExpenses(input: {
    userId: string;
    dto: UpdateExpenseDto;
    existing: ExpenseWithPresignedUrl;
    categoryId: string | null;
    currency: string;
    paymentMethod: PaymentMethod;
    creditCardId: string | null;
    installmentPlan: NonNullable<ReturnType<ExpensesService["buildInstallmentPlan"]>>;
  }) {
    const installmentGroupId =
      input.existing.installmentGroupId ?? input.existing.id;
    const keepImageUrl = input.existing.imageUrl ?? undefined;
    const selectedInstallmentIndex =
      input.existing.installmentIndex && input.existing.installmentIndex > 0
        ? input.existing.installmentIndex
        : 1;

    return this.prisma.$transaction(async (tx) => {
      await tx.expense.deleteMany({
        where: {
          userId: input.userId,
          OR: [{ id: input.existing.id }, { installmentGroupId }],
        },
      });

      const createdExpenses: ExpenseWithCategory[] = [];

      for (const scheduleItem of input.installmentPlan.schedule) {
        const created = await tx.expense.create({
          data: {
            title: input.dto.title ?? input.existing.title,
            cost: scheduleItem.amount,
            currency: input.currency,
            paymentMethod: input.paymentMethod,
            creditCardId: input.creditCardId,
            note:
              input.dto.note !== undefined
                ? input.dto.note
                : input.existing.note ?? undefined,
            date: scheduleItem.paymentDate,
            categoryId: input.categoryId ?? undefined,
            imageUrl: keepImageUrl,
            userId: input.userId,
            isInstallment: true,
            installmentGroupId,
            installmentCount: input.installmentPlan.installmentCount,
            installmentIndex: scheduleItem.installmentIndex,
            installmentTotalAmount: input.installmentPlan.totalAmount,
            installmentFrequency: input.installmentPlan.frequency,
            installmentPurchaseDate: input.installmentPlan.purchaseDate,
            installmentFirstPaymentDate: input.installmentPlan.firstPaymentDate,
          },
          include: {
            category: true,
            creditCard: { select: creditCardPublicSelect },
          },
        });

        createdExpenses.push(created);
      }

      return (
        createdExpenses.find(
          (item) => item.installmentIndex === selectedInstallmentIndex,
        ) ?? createdExpenses[0]
      );
    });
  }

  private async replaceInstallmentPlanWithSingleExpense(input: {
    userId: string;
    dto: UpdateExpenseDto;
    existing: ExpenseWithPresignedUrl;
    categoryId: string | null;
    currency: string;
    paymentMethod: PaymentMethod;
    creditCardId: string | null;
  }) {
    const installmentGroupId =
      input.existing.installmentGroupId ?? input.existing.id;
    const nextDate =
      input.dto.date !== undefined
        ? new Date(input.dto.date)
        : input.existing.installmentPurchaseDate ?? input.existing.date;

    return this.prisma.$transaction(async (tx) => {
      await tx.expense.deleteMany({
        where: {
          userId: input.userId,
          OR: [{ id: input.existing.id }, { installmentGroupId }],
        },
      });

      return tx.expense.create({
        data: {
          title: input.dto.title ?? input.existing.title,
          cost:
            input.dto.cost ??
            Number(
              input.existing.installmentTotalAmount ?? input.existing.cost,
            ),
          currency: input.currency,
          paymentMethod: input.paymentMethod,
          creditCardId: input.creditCardId,
          note:
            input.dto.note !== undefined
              ? input.dto.note
              : input.existing.note ?? undefined,
          date: nextDate,
          categoryId: input.categoryId ?? undefined,
          imageUrl: input.existing.imageUrl ?? undefined,
          userId: input.userId,
          isInstallment: false,
          installmentGroupId: null,
          installmentCount: null,
          installmentIndex: null,
          installmentTotalAmount: null,
          installmentFrequency: null,
          installmentPurchaseDate: null,
          installmentFirstPaymentDate: null,
        },
        include: {
          category: true,
          creditCard: { select: creditCardPublicSelect },
        },
      });
    });
  }

  private async resolveExistingCategoryId(
    userId: string,
    categoryId: string | null,
  ): Promise<string | null> {
    if (!categoryId) {
      return null;
    }

    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, userId },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException("Category not found for this user");
    }

    return category.id;
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

  private async getUserCurrency(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { currency: true },
    });

    return user?.currency ?? DEFAULT_EXPENSE_CURRENCY;
  }

  private buildCurrencyBreakdownFromExpenses(
    expenses: Array<{ cost: Prisma.Decimal; currency: string }>,
  ) {
    const totals = new Map<string, number>();

    for (const expense of expenses) {
      totals.set(
        expense.currency,
        (totals.get(expense.currency) ?? 0) + Number(expense.cost),
      );
    }

    return Array.from(totals.entries()).map(([currency, total]) => ({
      currency,
      total: this.roundMoney(total),
    }));
  }

  private roundMoney(value: number) {
    return Math.round(value * 100) / 100;
  }
}
