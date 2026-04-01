import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import type { StringValue } from "ms";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { FirebaseAdminService } from "../firebase/firebase-admin.service";
import { RegisterDto, LoginDto, GoogleAuthDto } from "./dto";
import { JwtPayload } from "./strategies/jwt.strategy";

const AUTH_USER_SELECT = {
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
} as const;

const LOGIN_USER_SELECT = {
  ...AUTH_USER_SELECT,
  password: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
    private readonly firebaseAdminService: FirebaseAdminService,
  ) {}

  async register(dto: RegisterDto, avatarFile?: Express.Multer.File) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException("Email already registered");
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    let avatarUrl: string | undefined;

    if (avatarFile) {
      avatarUrl = await this.storageService.uploadFile(avatarFile, "avatars");
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        password: hashedPassword,
        role: dto.role ?? "user",
        avatarUrl,
        isActive: true,
        isPremium: false,
        deletedAt: null,
      },
      select: AUTH_USER_SELECT,
    });

    return this.createAuthResponse(user, "User registered successfully");
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: LOGIN_USER_SELECT,
    });

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (!user.isActive) {
      throw new UnauthorizedException("Account is disabled");
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);

    if (!passwordValid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (user.deletedAt) {
      return this.createAuthResponse(
        await this.restoreDeletedUser(user.id),
        "Login successful",
      );
    }

    return this.createAuthResponse(user, "Login successful");
  }

  async loginWithGoogle(dto: GoogleAuthDto) {
    const decodedToken = await this.verifyGoogleToken(dto.firebaseIdToken);
    const provider = decodedToken.firebase?.sign_in_provider;

    if (provider !== "google.com") {
      throw new UnauthorizedException("Unsupported Google sign-in provider");
    }

    const email = decodedToken.email?.trim().toLowerCase();
    if (!email || decodedToken.email_verified !== true) {
      throw new UnauthorizedException("Google account email is not verified");
    }

    let user = await this.prisma.user.findUnique({
      where: { email },
      select: AUTH_USER_SELECT,
    });

    if (!user) {
      const generatedPassword = randomBytes(32).toString("hex");
      const hashedPassword = await bcrypt.hash(generatedPassword, 10);

      user = await this.prisma.user.create({
        data: {
          email,
          name: this.resolveGoogleDisplayName(decodedToken.name, email),
          password: hashedPassword,
          role: "user",
          avatarUrl: null,
          isActive: true,
          isPremium: false,
          deletedAt: null,
        },
        select: AUTH_USER_SELECT,
      });
    }

    if (!user.isActive) {
      throw new UnauthorizedException("Account is disabled");
    }

    if (user.deletedAt) {
      return this.createAuthResponse(
        await this.restoreDeletedUser(user.id),
        "Google authentication successful",
      );
    }

    return this.createAuthResponse(
      user,
      "Google authentication successful",
    );
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: AUTH_USER_SELECT,
      });

      if (!user) {
        throw new UnauthorizedException("User not found");
      }

      if (!user.isActive) {
        throw new UnauthorizedException("Account is disabled");
      }

      if (user.deletedAt) {
        return this.createAuthResponse(
          await this.restoreDeletedUser(user.id),
          "Session renewed successfully",
        );
      }

      return this.createAuthResponse(user, "Session renewed successfully");
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException("Invalid refresh token");
    }
  }

  private buildAccountState(user: {
    isActive: boolean;
    isPremium: boolean;
    deletedAt: Date | null;
  }) {
    return {
      isActive: user.isActive,
      isPremium: user.isPremium,
      isDisabled: !user.isActive || Boolean(user.deletedAt),
      deletedAt: user.deletedAt,
    };
  }

  private async generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const accessExpiresIn = this.configService.get<StringValue>(
      "JWT_EXPIRATION",
      "15m",
    );
    const refreshExpiresIn = this.configService.get<StringValue>(
      "JWT_REFRESH_EXPIRATION",
      "7d",
    );

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>("JWT_SECRET"),
        expiresIn: accessExpiresIn,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
        expiresIn: refreshExpiresIn,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async createAuthResponse(
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      avatarUrl: string | null;
      dailyBudget: unknown;
      budgetAmount: unknown;
      budgetPeriod: string;
      budgetPeriodStart: Date | null;
      budgetPeriodEnd: Date | null;
      currency: string;
      isActive: boolean;
      isPremium: boolean;
      deletedAt: Date | null;
    },
    message: string,
  ) {
    const tokens = await this.generateTokens(user.id, user.email);
    const authUser = await this.withAvatarPresignedUrl({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      dailyBudget: user.dailyBudget,
      budgetAmount: user.budgetAmount,
      budgetPeriod: user.budgetPeriod,
      budgetPeriodStart: user.budgetPeriodStart,
      budgetPeriodEnd: user.budgetPeriodEnd,
      currency: user.currency,
      isPremium: user.isPremium,
    });

    return {
      message,
      isAuthenticated: true,
      account: this.buildAccountState(user),
      user: authUser,
      ...tokens,
    };
  }

  private async restoreDeletedUser(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: null },
      select: AUTH_USER_SELECT,
    });
  }

  private async verifyGoogleToken(firebaseIdToken: string) {
    try {
      return await this.firebaseAdminService.verifyIdToken(firebaseIdToken);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      throw new UnauthorizedException("Invalid Google credentials");
    }
  }

  private resolveGoogleDisplayName(name: unknown, email: string): string {
    if (typeof name === "string" && name.trim().length > 0) {
      return name.trim().slice(0, 100);
    }

    return email.split("@")[0].slice(0, 100);
  }

  private async withAvatarPresignedUrl<T extends { avatarUrl: string | null }>(
    user: T,
  ): Promise<T> {
    if (!user.avatarUrl) {
      return user;
    }

    try {
      const presigned = await this.storageService.getFileUrl(user.avatarUrl);
      return { ...user, avatarUrl: presigned };
    } catch {
      return user;
    }
  }
}
