import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import type { FirebaseAdminService } from "../firebase/firebase-admin.service";

const activeUser = {
  id: "user-1",
  email: "known@example.com",
  name: "Known User",
  role: "user",
  avatarUrl: null,
  dailyBudget: null,
  budgetAmount: null,
  budgetPeriod: "DAILY",
  budgetPeriodStart: null,
  budgetPeriodEnd: null,
  currency: "MXN",
  isActive: true,
  isPremium: false,
  weeklyReportEnabled: false,
  monthlyReportEnabled: false,
  termsAcceptedAt: null,
  termsVersion: null,
  deletedAt: null,
};

function makeService(
  user: typeof activeUser | null,
  provider = "google.com",
  emailVerified = true,
) {
  const create = jest.fn().mockResolvedValue(activeUser);
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user), create },
    authSession: { create: jest.fn().mockResolvedValue({ id: "session-1" }) },
  };
  const firebaseAdmin = {
    verifyIdToken: jest.fn().mockResolvedValue({
      email: activeUser.email,
      email_verified: emailVerified,
      firebase: { sign_in_provider: provider },
    }),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === "JWT_EXPIRATION" ? "15m" : "secret",
    ),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    { signAsync: jest.fn().mockResolvedValue("jwt") } as unknown as JwtService,
    config as unknown as ConfigService,
    {} as unknown as StorageService,
    firebaseAdmin as unknown as FirebaseAdminService,
  );
  return { service, create };
}

describe("AuthService Google authentication", () => {
  it("authenticates existing account when existingUserOnly is true", async () => {
    const { service, create } = makeService(activeUser);
    await expect(
      service.loginWithGoogle({
        firebaseIdToken: "token",
        existingUserOnly: true,
      }),
    ).resolves.toMatchObject({ user: { id: activeUser.id } });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects unknown account without creating it in existing-user mode", async () => {
    const { service, create } = makeService(null);
    await expect(
      service.loginWithGoogle({
        firebaseIdToken: "token",
        existingUserOnly: true,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps legacy registration enabled when existingUserOnly is omitted", async () => {
    const { service, create } = makeService(null);
    await expect(
      service.loginWithGoogle({ firebaseIdToken: "token" }),
    ).resolves.toMatchObject({ user: { email: activeUser.email } });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects inactive existing accounts", async () => {
    const { service } = makeService({ ...activeUser, isActive: false });
    await expect(
      service.loginWithGoogle({
        firebaseIdToken: "token",
        existingUserOnly: true,
      }),
    ).rejects.toThrow("Account is disabled");
  });

  it("rejects tokens that were not issued by Google provider", async () => {
    const { service } = makeService(activeUser, "password");
    await expect(
      service.loginWithGoogle({
        firebaseIdToken: "token",
        existingUserOnly: true,
      }),
    ).rejects.toThrow("Unsupported Google sign-in provider");
  });

  it("rejects tokens with unverified email", async () => {
    const { service } = makeService(activeUser, "google.com", false);
    await expect(
      service.loginWithGoogle({
        firebaseIdToken: "token",
        existingUserOnly: true,
      }),
    ).rejects.toThrow("Google account email is not verified");
  });
});
