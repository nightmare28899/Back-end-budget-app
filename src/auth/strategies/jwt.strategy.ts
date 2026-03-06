import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";

export interface JwtPayload {
  sub: string;
  email: string;
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
        deletedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    if (!user.isActive || user.deletedAt) {
      throw new UnauthorizedException("Account is disabled");
    }

    const { isActive, deletedAt, ...activeUser } = user;
    return {
      ...activeUser,
      dailyBudget: Number(activeUser.dailyBudget),
      budgetAmount: Number(activeUser.budgetAmount),
      budgetPeriodStart: activeUser.budgetPeriodStart
        ? activeUser.budgetPeriodStart.toISOString()
        : null,
      budgetPeriodEnd: activeUser.budgetPeriodEnd
        ? activeUser.budgetPeriodEnd.toISOString()
        : null,
    };
  }
}
