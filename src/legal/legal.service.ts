import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export const PRIVACY_POLICY_VERSION = "2026-04-06";

@Injectable()
export class LegalService {
  constructor(private readonly prisma: PrismaService) {}

  async requestAccountDeletion(email: string, reason?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    await this.prisma.accountDeletionRequest.create({
      data: { email: normalizedEmail, reason, userId: user?.id },
    });

    return {
      message: "Your account deletion request has been received.",
      policyVersion: PRIVACY_POLICY_VERSION,
    };
  }
}
