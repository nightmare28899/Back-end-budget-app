import {
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { DevicePlatform, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { CurrentUserType } from "../common/types/current-user.type";
import { FirebaseAdminService } from "../firebase/firebase-admin.service";
import { RegisterDeviceTokenDto } from "./dto/register-device-token.dto";
import { RemoveDeviceTokenDto } from "./dto/remove-device-token.dto";
import { SendTestPushDto } from "./dto/send-test-push.dto";

interface PushMessageInput {
  title: string;
  body: string;
  data?: Record<string, string | number | boolean | null | undefined>;
}

export interface SendPushResult {
  tokenCount: number;
  successCount: number;
  failureCount: number;
  invalidTokensRemoved: number;
}

export interface SubscriptionReminderInput {
  id: string;
  userId: string;
  name: string;
  cost: Prisma.Decimal | number;
  currency: string;
  nextPaymentDate: Date;
  daysRemaining: number;
}

const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseAdminService: FirebaseAdminService,
  ) {}

  async registerDeviceToken(userId: string, dto: RegisterDeviceTokenDto) {
    const deviceToken = await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: {
        userId,
        token: dto.token,
        platform: dto.platform as DevicePlatform,
        lastSeenAt: new Date(),
      },
      update: {
        userId,
        platform: dto.platform as DevicePlatform,
        lastSeenAt: new Date(),
      },
    });

    return {
      message: "Device token registered successfully",
      deviceToken,
    };
  }

  async removeDeviceToken(userId: string, dto: RemoveDeviceTokenDto) {
    const removed = await this.prisma.deviceToken.deleteMany({
      where: {
        userId,
        token: dto.token,
      },
    });

    return {
      message:
        removed.count > 0
          ? "Device token removed successfully"
          : "Device token not found",
      removedCount: removed.count,
    };
  }

  async sendTestPush(currentUser: CurrentUserType, dto: SendTestPushDto) {
    this.assertAdmin(currentUser);

    const result = await this.sendToUser(dto.userId, {
      title: dto.title,
      body: dto.body,
      data: {
        type: "admin_test",
        source: "admin-panel",
        targetScreen: "Dashboard",
      },
    });

    return {
      message:
        result.tokenCount === 0
          ? "Selected user does not have any registered mobile devices"
          : result.successCount > 0
            ? "Test push sent successfully"
            : "Push request was processed but no notification was accepted",
      ...result,
    };
  }

  async sendSubscriptionReminder(
    subscription: SubscriptionReminderInput,
  ): Promise<SendPushResult> {
    return this.sendToUser(subscription.userId, {
      title: `Upcoming payment: ${subscription.name}`,
      body: this.buildSubscriptionReminderBody(subscription),
      data: {
        type: "subscription_reminder",
        subscriptionId: subscription.id,
        upcomingDays: String(subscription.daysRemaining),
        targetScreen: "UpcomingSubscriptions",
      },
    });
  }

  async sendToUser(
    userId: string,
    message: PushMessageInput,
  ): Promise<SendPushResult> {
    const deviceTokens = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
      orderBy: { updatedAt: "desc" },
    });

    const tokens = Array.from(
      new Set(deviceTokens.map((item) => item.token.trim()).filter(Boolean)),
    );

    if (tokens.length === 0) {
      return {
        tokenCount: 0,
        successCount: 0,
        failureCount: 0,
        invalidTokensRemoved: 0,
      };
    }

    const messaging = this.firebaseAdminService.getMessagingOrThrow();
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: message.title,
        body: message.body,
      },
      data: this.normalizeData(message.data),
      android: {
        priority: "high",
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    });

    const invalidTokens = tokens.filter((token, index) => {
      const errorCode = response.responses[index]?.error?.code;
      return !!errorCode && INVALID_TOKEN_CODES.has(errorCode);
    });

    if (invalidTokens.length > 0) {
      await this.prisma.deviceToken.deleteMany({
        where: {
          token: {
            in: invalidTokens,
          },
        },
      });
    }

    return {
      tokenCount: tokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokensRemoved: invalidTokens.length,
    };
  }

  private normalizeData(
    data?: Record<string, string | number | boolean | null | undefined>,
  ): Record<string, string> | undefined {
    if (!data) {
      return undefined;
    }

    const entries = Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)] as const);

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  private buildSubscriptionReminderBody(
    subscription: SubscriptionReminderInput,
  ): string {
    const amount = Number(subscription.cost).toFixed(2);

    if (subscription.daysRemaining <= 0) {
      return `${subscription.name} is due today for ${subscription.currency} ${amount}.`;
    }

    return `${subscription.name} will charge ${subscription.currency} ${amount} in ${subscription.daysRemaining} day(s).`;
  }

  private assertAdmin(currentUser: CurrentUserType) {
    if ((currentUser.role || "").toLowerCase() !== "admin") {
      throw new ForbiddenException(
        "Only administrators can send test push notifications",
      );
    }
  }
}
