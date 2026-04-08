import {
  Injectable,
  ConflictException,
  Logger,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as bcrypt from "bcrypt";
import { randomBytes, randomUUID } from "node:crypto";
import type { StringValue } from "ms";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { FirebaseAdminService } from "../firebase/firebase-admin.service";
import { RegisterDto, LoginDto, GoogleAuthDto } from "./dto";
import { JwtPayload } from "./strategies/jwt.strategy";
import type { CurrentUserType } from "../common/types/current-user.type";

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
  weeklyReportEnabled: true,
  monthlyReportEnabled: true,
  termsAcceptedAt: true,
  termsVersion: true,
  deletedAt: true,
} as const;

const LOGIN_USER_SELECT = {
  ...AUTH_USER_SELECT,
  password: true,
} as const;

interface RefreshJwtPayload extends JwtPayload {
  jti?: string;
  type?: "refresh";
}

interface AuthResponseOptions {
  sessionId?: string;
  previousRefreshTokenId?: string;
}

const DEFAULT_AUTH_SESSION_RETENTION_DAYS = 30;
const DEFAULT_REFRESH_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;
const CURRENT_TERMS_VERSION = "2026-04-06";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
    private readonly firebaseAdminService: FirebaseAdminService,
  ) {}

  async register(dto: RegisterDto, avatarFile?: Express.Multer.File) {
    return this.runAuthOperation("register", async () => {
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
          ...this.buildTermsAcceptanceData(dto.termsAccepted),
          deletedAt: null,
        },
        select: AUTH_USER_SELECT,
      });

      this.logSecurityEvent("log", "auth.register.success", {
        userId: user.id,
        email: this.maskEmail(user.email),
      });

      return this.createAuthResponse(user, "User registered successfully");
    });
  }

  async login(dto: LoginDto) {
    return this.runAuthOperation("login", async () => {
      const normalizedEmail = dto.email.trim().toLowerCase();
      const user = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: LOGIN_USER_SELECT,
      });

      if (!user) {
        this.logSecurityEvent("warn", "auth.login.invalid_user", {
          email: this.maskEmail(normalizedEmail),
        });
        throw new UnauthorizedException("Invalid credentials");
      }

      if (!user.isActive) {
        this.logSecurityEvent("warn", "auth.login.disabled_account", {
          userId: user.id,
          email: this.maskEmail(user.email),
        });
        throw new UnauthorizedException("Account is disabled");
      }

      const passwordValid = await bcrypt.compare(dto.password, user.password);

      if (!passwordValid) {
        this.logSecurityEvent("warn", "auth.login.invalid_password", {
          userId: user.id,
          email: this.maskEmail(user.email),
        });
        throw new UnauthorizedException("Invalid credentials");
      }

      if (user.deletedAt) {
        this.logSecurityEvent("log", "auth.login.restore_deleted_user", {
          userId: user.id,
          email: this.maskEmail(user.email),
        });
        return this.createAuthResponse(
          await this.restoreDeletedUser(user.id),
          "Login successful",
        );
      }

      this.logSecurityEvent("log", "auth.login.success", {
        userId: user.id,
        email: this.maskEmail(user.email),
      });
      return this.createAuthResponse(user, "Login successful");
    });
  }

  async loginWithGoogle(dto: GoogleAuthDto) {
    return this.runAuthOperation("google login", async () => {
      const decodedToken = await this.verifyGoogleToken(dto.firebaseIdToken);
      const provider = decodedToken.firebase?.sign_in_provider;

      if (provider !== "google.com") {
        this.logSecurityEvent("warn", "auth.google.unsupported_provider", {
          provider,
        });
        throw new UnauthorizedException("Unsupported Google sign-in provider");
      }

      const email = decodedToken.email?.trim().toLowerCase();
      if (!email || decodedToken.email_verified !== true) {
        this.logSecurityEvent("warn", "auth.google.unverified_email", {
          email: this.maskEmail(email),
        });
        throw new UnauthorizedException("Google account email is not verified");
      }
      const googleAvatarUrl = this.resolveGoogleAvatarUrl(decodedToken.picture);

      let user = await this.prisma.user.findUnique({
        where: { email },
        select: AUTH_USER_SELECT,
      });

      if (!user) {
        const generatedPassword = randomBytes(32).toString("hex");
        const hashedPassword = await bcrypt.hash(generatedPassword, 10);
        const avatarUrl = await this.importGoogleAvatar(googleAvatarUrl, email);

        user = await this.prisma.user.create({
          data: {
            email,
            name: this.resolveGoogleDisplayName(decodedToken.name, email),
            password: hashedPassword,
            role: "user",
            avatarUrl,
            isActive: true,
            isPremium: false,
            ...this.buildTermsAcceptanceData(dto.termsAccepted),
            deletedAt: null,
          },
          select: AUTH_USER_SELECT,
        });
      } else if (!user.avatarUrl && googleAvatarUrl) {
        const avatarUrl = await this.importGoogleAvatar(googleAvatarUrl, email);
        if (avatarUrl) {
          user = await this.prisma.user.update({
            where: { id: user.id },
            data: { avatarUrl },
            select: AUTH_USER_SELECT,
          });
        }
      }

      if (
        dto.termsAccepted &&
        (!user.termsAcceptedAt || user.termsVersion !== CURRENT_TERMS_VERSION)
      ) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: this.buildTermsAcceptanceData(true),
          select: AUTH_USER_SELECT,
        });
      }

      if (!user.isActive) {
        this.logSecurityEvent("warn", "auth.google.disabled_account", {
          userId: user.id,
          email: this.maskEmail(user.email),
        });
        throw new UnauthorizedException("Account is disabled");
      }

      if (user.deletedAt) {
        this.logSecurityEvent("log", "auth.google.restore_deleted_user", {
          userId: user.id,
          email: this.maskEmail(user.email),
        });
        return this.createAuthResponse(
          await this.restoreDeletedUser(user.id),
          "Google authentication successful",
        );
      }

      this.logSecurityEvent("log", "auth.google.success", {
        userId: user.id,
        email: this.maskEmail(user.email),
      });
      return this.createAuthResponse(user, "Google authentication successful");
    });
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<RefreshJwtPayload>(refreshToken, {
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

      const isLegacyRefreshToken =
        !payload.sid && !payload.jti && payload.type === undefined;

      if (!isLegacyRefreshToken) {
        if (!payload.sid || !payload.jti || payload.type !== "refresh") {
          this.logSecurityEvent("warn", "auth.refresh.invalid_claims", {
            sessionId: payload.sid ?? null,
          });
          throw new UnauthorizedException("Invalid refresh token");
        }

        await this.assertActiveSession(payload.sub, payload.sid, payload.jti);
      }

      if (user.deletedAt) {
        this.logSecurityEvent("log", "auth.refresh.restore_deleted_user", {
          userId: user.id,
          sessionId: payload.sid ?? "legacy-session",
        });
        return this.createAuthResponse(
          await this.restoreDeletedUser(user.id),
          "Session renewed successfully",
          isLegacyRefreshToken
            ? undefined
            : {
                sessionId: payload.sid,
                previousRefreshTokenId: payload.jti,
              },
        );
      }

      this.logSecurityEvent("log", "auth.refresh.success", {
        userId: user.id,
        sessionId: payload.sid ?? "legacy-session",
      });
      return this.createAuthResponse(
        user,
        "Session renewed successfully",
        isLegacyRefreshToken
          ? undefined
          : {
              sessionId: payload.sid,
              previousRefreshTokenId: payload.jti,
            },
      );
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.logSecurityEvent("warn", "auth.refresh.rejected", {
          reason: error.message,
        });
        throw error;
      }
      this.throwIfAuthInfrastructureError("refresh", error);
      this.logSecurityEvent("warn", "auth.refresh.invalid_token", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      throw new UnauthorizedException("Invalid refresh token");
    }
  }

  async logout(user: CurrentUserType) {
    if (user.sessionId) {
      await this.revokeSession(user.id, user.sessionId);
      this.logSecurityEvent("log", "auth.logout.success", {
        userId: user.id,
        sessionId: user.sessionId,
      });
    } else {
      this.logSecurityEvent("warn", "auth.logout.no_session", {
        userId: user.id,
      });
    }

    return {
      message: "Session revoked successfully",
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredAuthSessions() {
    const retentionMs = this.getAuthSessionRetentionMs();
    const refreshExpirationMs = this.getRefreshExpirationMs();
    const now = Date.now();
    const revokedSessionCutoff = new Date(now - retentionMs);
    const staleSessionCutoff = new Date(
      now - retentionMs - refreshExpirationMs,
    );

    const deleted = await this.prisma.authSession.deleteMany({
      where: {
        OR: [
          {
            revokedAt: {
              lt: revokedSessionCutoff,
            },
          },
          {
            revokedAt: null,
            updatedAt: {
              lt: staleSessionCutoff,
            },
          },
        ],
      },
    });

    if (deleted.count > 0) {
      this.logSecurityEvent("log", "auth.session.cleanup", {
        deletedCount: deleted.count,
      });
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

  private async generateTokens(
    userId: string,
    email: string,
    sessionId: string,
    refreshTokenId: string,
  ) {
    const accessPayload: JwtPayload = {
      sub: userId,
      email,
      sid: sessionId,
    };
    const refreshPayload: RefreshJwtPayload = {
      ...accessPayload,
      jti: refreshTokenId,
      type: "refresh",
    };

    const accessExpiresIn = this.configService.get<StringValue>(
      "JWT_EXPIRATION",
      "15m",
    );
    const refreshExpiresIn = this.configService.get<StringValue>(
      "JWT_REFRESH_EXPIRATION",
      "7d",
    );

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.get<string>("JWT_SECRET"),
        expiresIn: accessExpiresIn,
      }),
      this.jwtService.signAsync(refreshPayload, {
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
    options?: AuthResponseOptions,
  ) {
    const tokens = await this.issueSessionTokens(user.id, user.email, options);
    const authUser = this.withAvatarPresignedUrl({
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
    await this.revokeUserSessions(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: null },
      select: AUTH_USER_SELECT,
    });
  }

  private async issueSessionTokens(
    userId: string,
    email: string,
    options?: AuthResponseOptions,
  ) {
    const refreshTokenId = randomUUID();

    let sessionId = options?.sessionId;
    if (sessionId) {
      const rotatedSession = await this.prisma.authSession.updateMany({
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
          ...(options?.previousRefreshTokenId
            ? {
                currentRefreshTokenId: options.previousRefreshTokenId,
              }
            : {}),
        },
        data: {
          currentRefreshTokenId: refreshTokenId,
        },
      });

      if (rotatedSession.count === 0) {
        throw new UnauthorizedException("Invalid refresh token");
      }
    } else {
      const session = await this.prisma.authSession.create({
        data: {
          userId,
          currentRefreshTokenId: refreshTokenId,
        },
        select: {
          id: true,
        },
      });
      sessionId = session.id;
    }

    return this.generateTokens(userId, email, sessionId, refreshTokenId);
  }

  private async assertActiveSession(
    userId: string,
    sessionId: string,
    refreshTokenId: string,
  ) {
    const session = await this.prisma.authSession.findFirst({
      where: {
        id: sessionId,
        userId,
        currentRefreshTokenId: refreshTokenId,
        revokedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!session) {
      this.logSecurityEvent("warn", "auth.session.invalid", {
        userId,
        sessionId,
      });
      throw new UnauthorizedException("Invalid refresh token");
    }
  }

  private async revokeSession(userId: string, sessionId: string) {
    await this.prisma.authSession.updateMany({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  private async revokeUserSessions(userId: string) {
    await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  private getAuthSessionRetentionMs() {
    const rawValue = this.configService.get<string>(
      "AUTH_SESSION_RETENTION_DAYS",
      `${DEFAULT_AUTH_SESSION_RETENTION_DAYS}`,
    );
    const parsed = Number.parseInt(rawValue, 10);
    const safeDays =
      Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_AUTH_SESSION_RETENTION_DAYS;
    return safeDays * 24 * 60 * 60 * 1000;
  }

  private getRefreshExpirationMs() {
    const rawValue = this.configService.get<string>(
      "JWT_REFRESH_EXPIRATION",
      "7d",
    );
    return this.parseDurationToMs(rawValue) ?? DEFAULT_REFRESH_EXPIRATION_MS;
  }

  private parseDurationToMs(rawValue: string): number | null {
    const normalized = rawValue.trim().toLowerCase();
    const match = normalized.match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) {
      return null;
    }

    const value = Number.parseInt(match[1], 10);
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }

    const unit = match[2];
    const multipliers: Record<string, number> = {
      ms: 1,
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return value * multipliers[unit];
  }

  private buildTermsAcceptanceData(termsAccepted?: boolean) {
    if (!termsAccepted) {
      return {};
    }

    return {
      termsAcceptedAt: new Date(),
      termsVersion: CURRENT_TERMS_VERSION,
    };
  }

  private async runAuthOperation<T>(
    operation: "register" | "login" | "google login",
    callback: () => Promise<T>,
  ): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof UnauthorizedException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      this.throwIfAuthInfrastructureError(operation, error);
      throw error;
    }
  }

  private throwIfAuthInfrastructureError(
    operation: string,
    error: unknown,
  ): void {
    const prismaCode = this.getPrismaErrorCode(error);
    if (prismaCode === "P2021" || prismaCode === "P2022") {
      this.logger.error(
        `Auth ${operation} failed due to a database schema mismatch (${prismaCode}). Apply the latest Prisma migrations for auth sessions and terms acceptance.`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        "Authentication service is temporarily unavailable. Apply the latest backend database migrations and try again.",
      );
    }

    if (prismaCode === "P1001" || prismaCode === "P1008") {
      this.logger.error(
        `Auth ${operation} failed because the database is unavailable (${prismaCode}).`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        "Authentication service is temporarily unavailable. Please try again later.",
      );
    }

    if (this.getErrorName(error) === "PrismaClientInitializationError") {
      this.logger.error(
        `Auth ${operation} failed because Prisma could not initialize.`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        "Authentication service is temporarily unavailable. Please try again later.",
      );
    }
  }

  private getPrismaErrorCode(error: unknown): string | null {
    if (!error || typeof error !== "object" || !("code" in error)) {
      return null;
    }

    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }

  private getErrorName(error: unknown): string | null {
    if (!error || typeof error !== "object" || !("name" in error)) {
      return null;
    }

    const name = (error as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  }

  private logSecurityEvent(
    level: "log" | "warn",
    event: string,
    details: Record<string, unknown>,
  ) {
    const serializedDetails = Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ");

    const message = serializedDetails
      ? `[security] ${event} ${serializedDetails}`
      : `[security] ${event}`;

    this.logger[level](message);
  }

  private maskEmail(email?: string | null) {
    if (!email) {
      return "unknown";
    }

    const [localPart, domain = ""] = email.split("@");
    const trimmedLocalPart = localPart.trim();
    if (trimmedLocalPart.length <= 2) {
      return `${trimmedLocalPart[0] ?? "*"}***@${domain}`;
    }

    return `${trimmedLocalPart.slice(0, 2)}***@${domain}`;
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

  private resolveGoogleAvatarUrl(picture: unknown): string | null {
    if (typeof picture !== "string") {
      return null;
    }

    const normalized = picture.trim();
    if (!normalized) {
      return null;
    }

    return normalized;
  }

  private async importGoogleAvatar(
    pictureUrl: string | null,
    email: string,
  ): Promise<string | null> {
    if (!pictureUrl) {
      return null;
    }

    try {
      const response = await fetch(pictureUrl);
      if (!response.ok) {
        this.logger.warn(
          `Skipping Google avatar import for ${email}: upstream returned ${response.status}`,
        );
        return null;
      }

      const contentType = response.headers.get("content-type")?.trim() || "";
      if (!contentType.toLowerCase().startsWith("image/")) {
        this.logger.warn(
          `Skipping Google avatar import for ${email}: unsupported content-type "${contentType || "unknown"}"`,
        );
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0) {
        this.logger.warn(
          `Skipping Google avatar import for ${email}: empty response body`,
        );
        return null;
      }

      return await this.storageService.uploadBuffer(buffer, {
        folder: "avatars",
        mimeType: contentType,
        extension: this.resolveImageExtension(contentType, pictureUrl),
        size: buffer.byteLength,
      });
    } catch (error) {
      this.logger.warn(
        `Google avatar import failed for ${email}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return null;
    }
  }

  private resolveImageExtension(
    contentType: string,
    pictureUrl: string,
  ): string | null {
    const mimeType = contentType.toLowerCase();
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
      return "jpg";
    }
    if (mimeType.includes("png")) {
      return "png";
    }
    if (mimeType.includes("webp")) {
      return "webp";
    }
    if (mimeType.includes("gif")) {
      return "gif";
    }

    try {
      const pathname = new URL(pictureUrl).pathname;
      const rawExtension = pathname.split(".").pop()?.trim().toLowerCase();
      return rawExtension || null;
    } catch {
      return null;
    }
  }

  private withAvatarPresignedUrl<T extends { avatarUrl: string | null }>(
    user: T,
  ): T {
    if (!user.avatarUrl) {
      return user;
    }

    return { ...user, avatarUrl: this.buildAvatarProxyUrl(user.avatarUrl) };
  }

  private buildAvatarProxyUrl(avatarKey: string): string {
    const filename = avatarKey.replace(/^avatars\//, "").trim();
    if (!filename) {
      return avatarKey;
    }

    return `/api/storage/avatars/${encodeURIComponent(filename)}`;
  }
}
