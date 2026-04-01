import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";

export interface JwtPayload {
  sub: string;
  email: string;
  sid?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = configService.get<string>("JWT_SECRET");
    if (!secret) {
      throw new Error("JWT_SECRET is not defined in the environment");
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.sid) {
      const session = await this.prisma.authSession.findUnique({
        where: { id: payload.sid },
        select: {
          id: true,
          userId: true,
          revokedAt: true,
        },
      });

      if (
        !session ||
        session.userId !== payload.sub ||
        session.revokedAt !== null
      ) {
        throw new UnauthorizedException("Session is no longer active");
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        dailyBudget: true,
        budgetAmount: true,
        budgetPeriod: true,
        budgetPeriodStart: true,
        budgetPeriodEnd: true,
        currency: true,
        isActive: true,
        isPremium: true,
        deletedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    if (!user.isActive || user.deletedAt) {
      throw new UnauthorizedException("Account is disabled");
    }

    return {
      id: user.id,
      sessionId: payload.sid ?? null,
      email: user.email,
      name: user.name,
      role: user.role,
      currency: user.currency,
      isPremium: user.isPremium,
      budgetPeriod: user.budgetPeriod,
      dailyBudget: Number(user.dailyBudget),
      budgetAmount: Number(user.budgetAmount),
      budgetPeriodStart: user.budgetPeriodStart
        ? user.budgetPeriodStart.toISOString()
        : null,
      budgetPeriodEnd: user.budgetPeriodEnd
        ? user.budgetPeriodEnd.toISOString()
        : null,
    };
  }
}
