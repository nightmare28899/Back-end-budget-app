import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAccountState(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        isPremium: true,
        deletedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    return {
      isAuthenticated: true,
      isPremium: user.isPremium,
      isActive: user.isActive,
      isDisabled: !user.isActive || Boolean(user.deletedAt),
      deletedAt: user.deletedAt,
    };
  }

  async assertPremium(userId: string, feature: string) {
    const state = await this.getAccountState(userId);

    if (state.isDisabled) {
      throw new UnauthorizedException("Account is disabled");
    }

    if (!state.isPremium) {
      throw new ForbiddenException({
        code: "PREMIUM_REQUIRED",
        message: "Premium subscription required",
        feature,
        isPremium: false,
      });
    }
  }
}
