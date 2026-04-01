import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateUserDto } from "./dto/update-user.dto";
import { StorageService } from "../storage/storage.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { QueryUsersDto } from "./dto/query-users.dto";
import type { CurrentUserType } from "../common/types/current-user.type";
import {
  type BudgetPeriod,
  normalizeBudgetPeriod,
} from "../common/budget/budget.utils";

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  avatarUrl: true,
  dailyBudget: true,
  budgetAmount: true,
  budgetPeriod: true,
  budgetPeriodStart: true,
  budgetPeriodEnd: true,
  currency: true,
  isActive: true,
  isPremium: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface UserBudgetSnapshot {
  dailyBudget: Prisma.Decimal;
  budgetAmount: Prisma.Decimal;
  budgetPeriod: string;
  budgetPeriodStart: Date | null;
  budgetPeriodEnd: Date | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async create(currentUser: CurrentUserType, dto: CreateUserDto) {
    if (currentUser.role.toLowerCase() !== "admin") {
      throw new ForbiddenException("Only administrators can create users");
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException("Email already registered");
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const budgetData = this.resolveBudgetForCreate(dto);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        password: hashedPassword,
        role: dto.role ?? "user",
        ...budgetData,
        currency: dto.currency,
        isActive: true,
        isPremium: false,
        deletedAt: null,
      },
      select: userSelect,
    });

    return this.withAvatarPresignedUrl(user);
  }

  async findAll(currentUser: CurrentUserType, query: QueryUsersDto) {
    const includeDisabled = query.includeDisabled === true;
    const where =
      currentUser.role.toLowerCase() === "admin"
        ? {
            ...(includeDisabled ? {} : { isActive: true, deletedAt: null }),
          }
        : {
            id: currentUser.id,
            ...(includeDisabled ? {} : { isActive: true, deletedAt: null }),
          };

    const users = await this.prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { createdAt: "desc" },
    });

    return this.withAvatarPresignedUrls(users);
  }

  async findOne(
    userId: string,
    currentUser: CurrentUserType,
    includeDisabled = false,
  ) {
    this.assertCanManageUser(currentUser, userId);

    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        ...(includeDisabled ? {} : { isActive: true, deletedAt: null }),
      },
      select: userSelect,
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return this.withAvatarPresignedUrl(user);
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return this.withAvatarPresignedUrl(user);
  }

  async updateProfile(
    userId: string,
    currentUser: CurrentUserType,
    dto: UpdateUserDto,
    avatarFile?: Express.Multer.File,
  ) {
    return this.updateUser(userId, currentUser, dto, avatarFile);
  }

  async update(
    userId: string,
    currentUser: CurrentUserType,
    dto: UpdateUserDto,
    avatarFile?: Express.Multer.File,
  ) {
    this.assertCanManageUser(currentUser, userId);
    return this.updateUser(userId, currentUser, dto, avatarFile);
  }

  async disable(userId: string, currentUser: CurrentUserType) {
    this.assertCanManageUser(currentUser, userId);

    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        deletedAt: true,
      },
    });

    if (!existingUser) {
      throw new NotFoundException("User not found");
    }

    if (!existingUser.isActive && existingUser.deletedAt) {
      return existingUser;
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
      select: {
        id: true,
        isActive: true,
        deletedAt: true,
      },
    });
  }

  private async updateUser(
    userId: string,
    currentUser: CurrentUserType,
    dto: UpdateUserDto,
    avatarFile?: Express.Multer.File,
  ) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        avatarUrl: true,
        dailyBudget: true,
        budgetAmount: true,
        budgetPeriod: true,
        budgetPeriodStart: true,
        budgetPeriodEnd: true,
      },
    });

    if (!current) {
      throw new NotFoundException("User not found");
    }

    const isAdmin = currentUser.role.toLowerCase() === "admin";
    const isSelf = currentUser.id === userId;

    if (dto.isPremium !== undefined && !isAdmin) {
      throw new ForbiddenException(
        "Only administrators can change premium entitlement",
      );
    }

    if (dto.isActive !== undefined && !isAdmin) {
      throw new ForbiddenException(
        "Only administrators can change account active status",
      );
    }

    if (dto.password !== undefined && !isAdmin && !isSelf) {
      throw new ForbiddenException(
        "Only administrators can set temporary passwords for other users",
      );
    }

    let nextAvatarKey: string | undefined;

    if (avatarFile) {
      nextAvatarKey = await this.storageService.uploadFile(
        avatarFile,
        "avatars",
      );
    }

    const budgetData = this.resolveBudgetForUpdate(dto, current);
    const hashedPassword = dto.password
      ? await bcrypt.hash(dto.password, 10)
      : undefined;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        currency: dto.currency,
        ...(dto.isActive !== undefined
          ? {
              isActive: dto.isActive,
              deletedAt: dto.isActive ? null : new Date(),
            }
          : {}),
        ...(dto.isPremium !== undefined ? { isPremium: dto.isPremium } : {}),
        ...(hashedPassword ? { password: hashedPassword } : {}),
        ...budgetData,
        avatarUrl: nextAvatarKey ?? undefined,
      },
      select: userSelect,
    });

    if (
      nextAvatarKey &&
      current?.avatarUrl &&
      current.avatarUrl !== nextAvatarKey
    ) {
      try {
        await this.storageService.deleteFile(current.avatarUrl);
      } catch (error) {
        console.error(error);
      }
    }

    return this.withAvatarPresignedUrl(user);
  }

  private assertCanManageUser(
    currentUser: CurrentUserType,
    targetUserId: string,
  ) {
    if (currentUser.role.toLowerCase() === "admin") {
      return;
    }

    if (currentUser.id === targetUserId) {
      return;
    }

    throw new ForbiddenException("You can only manage your own account");
  }

  private async withAvatarPresignedUrls<T extends { avatarUrl: string | null }>(
    users: T[],
  ) {
    return Promise.all(users.map((user) => this.withAvatarPresignedUrl(user)));
  }

  private async withAvatarPresignedUrl<T extends { avatarUrl: string | null }>(
    user: T | null,
  ): Promise<(T & { avatarKey: string | null }) | null> {
    if (!user) {
      return null;
    }

    const avatarKey = user.avatarUrl;

    if (!avatarKey) {
      return { ...user, avatarKey: null };
    }

    return {
      ...user,
      avatarUrl: this.buildAvatarProxyUrl(avatarKey),
      avatarKey,
    };
  }

  private buildAvatarProxyUrl(avatarKey: string): string {
    const filename = avatarKey.replace(/^avatars\//, "").trim();
    if (!filename) {
      return avatarKey;
    }

    return `/api/storage/avatars/${encodeURIComponent(filename)}`;
  }

  private resolveBudgetForCreate(dto: CreateUserDto) {
    const budgetAmount = dto.budgetAmount ?? dto.dailyBudget ?? 0;
    const budgetPeriod = normalizeBudgetPeriod(dto.budgetPeriod);
    const budgetPeriodStart = dto.budgetPeriodStart
      ? new Date(dto.budgetPeriodStart)
      : null;
    const budgetPeriodEnd = dto.budgetPeriodEnd
      ? new Date(dto.budgetPeriodEnd)
      : null;

    this.assertBudgetConfiguration(
      budgetPeriod,
      budgetPeriodStart,
      budgetPeriodEnd,
      dto.budgetPeriodStart !== undefined || dto.budgetPeriodEnd !== undefined,
    );

    return {
      dailyBudget: budgetAmount,
      budgetAmount,
      budgetPeriod,
      budgetPeriodStart: budgetPeriod === "period" ? budgetPeriodStart : null,
      budgetPeriodEnd: budgetPeriod === "period" ? budgetPeriodEnd : null,
    };
  }

  private resolveBudgetForUpdate(
    dto: UpdateUserDto,
    current: UserBudgetSnapshot,
  ): Prisma.UserUpdateInput {
    const budgetTouched =
      dto.budgetAmount !== undefined ||
      dto.dailyBudget !== undefined ||
      dto.budgetPeriod !== undefined ||
      dto.budgetPeriodStart !== undefined ||
      dto.budgetPeriodEnd !== undefined;

    if (!budgetTouched) {
      return {};
    }

    const nextBudgetAmount =
      dto.budgetAmount ??
      dto.dailyBudget ??
      Number(current.budgetAmount ?? current.dailyBudget);

    const nextBudgetPeriod =
      dto.budgetPeriod !== undefined
        ? normalizeBudgetPeriod(dto.budgetPeriod)
        : normalizeBudgetPeriod(current.budgetPeriod);

    const nextBudgetPeriodStart =
      dto.budgetPeriodStart !== undefined
        ? new Date(dto.budgetPeriodStart)
        : current.budgetPeriodStart;

    const nextBudgetPeriodEnd =
      dto.budgetPeriodEnd !== undefined
        ? new Date(dto.budgetPeriodEnd)
        : current.budgetPeriodEnd;

    this.assertBudgetConfiguration(
      nextBudgetPeriod,
      nextBudgetPeriodStart,
      nextBudgetPeriodEnd,
      dto.budgetPeriodStart !== undefined || dto.budgetPeriodEnd !== undefined,
    );

    return {
      dailyBudget: nextBudgetAmount,
      budgetAmount: nextBudgetAmount,
      budgetPeriod: nextBudgetPeriod,
      budgetPeriodStart:
        nextBudgetPeriod === "period" ? nextBudgetPeriodStart : null,
      budgetPeriodEnd:
        nextBudgetPeriod === "period" ? nextBudgetPeriodEnd : null,
    };
  }

  private assertBudgetConfiguration(
    period: BudgetPeriod,
    start: Date | null,
    end: Date | null,
    hasPeriodDatesInRequest: boolean,
  ) {
    if (period !== "period") {
      if (hasPeriodDatesInRequest) {
        throw new BadRequestException(
          "budgetPeriodStart and budgetPeriodEnd can only be set when budgetPeriod is 'period'",
        );
      }
      return;
    }

    if (!start || !end) {
      throw new BadRequestException(
        "budgetPeriodStart and budgetPeriodEnd are required when budgetPeriod is 'period'",
      );
    }

    if (end < start) {
      throw new BadRequestException(
        "budgetPeriodEnd must be greater than or equal to budgetPeriodStart",
      );
    }
  }
}
