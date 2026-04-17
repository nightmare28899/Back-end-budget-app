import { ForbiddenException, Injectable } from "@nestjs/common";
import { DevicePlatform, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { CurrentUserType } from "../common/types/current-user.type";
import { FirebaseAdminService } from "../firebase/firebase-admin.service";
import { RegisterDeviceTokenDto } from "./dto/register-device-token.dto";
import { RemoveDeviceTokenDto } from "./dto/remove-device-token.dto";
import { SendTestPushDto } from "./dto/send-test-push.dto";
import {
  normalizeNotificationLanguage,
  type NotificationLanguage,
} from "./notification-language";

interface PushMessageInput {
  title: string;
  body: string;
  data?: Record<string, string | number | boolean | null | undefined>;
}

interface LocalizedPushMessageInput {
  resolveMessage: (language: NotificationLanguage) => PushMessageInput;
}

export interface SendPushResult {
  tokenCount: number;
  successCount: number;
  failureCount: number;
  invalidTokensRemoved: number;
  failureReasons: Record<string, number>;
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

type NotificationMessageInput = PushMessageInput | LocalizedPushMessageInput;

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
        language: normalizeNotificationLanguage(dto.language),
        lastSeenAt: new Date(),
      },
      update: {
        userId,
        platform: dto.platform as DevicePlatform,
        language: normalizeNotificationLanguage(dto.language),
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
      resolveMessage: (language) => ({
        ...this.buildSubscriptionReminderMessage(subscription, language),
        data: {
          type: "subscription_reminder",
          subscriptionId: subscription.id,
          upcomingDays: String(subscription.daysRemaining),
          targetScreen: "UpcomingSubscriptions",
        },
      }),
    });
  }

  async sendToUser(
    userId: string,
    message: NotificationMessageInput,
  ): Promise<SendPushResult> {
    const deviceTokens = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true, language: true },
      orderBy: { updatedAt: "desc" },
    });

    const recipientsByToken = new Map<string, NotificationLanguage>();
    for (const deviceToken of deviceTokens) {
      const normalizedToken = deviceToken.token.trim();
      if (!normalizedToken || recipientsByToken.has(normalizedToken)) {
        continue;
      }

      recipientsByToken.set(
        normalizedToken,
        normalizeNotificationLanguage(deviceToken.language),
      );
    }

    const recipientGroups = Array.from(recipientsByToken.entries()).reduce<
      Record<NotificationLanguage, string[]>
    >(
      (acc, [token, language]) => {
        acc[language].push(token);
        return acc;
      },
      { en: [], es: [] },
    );

    const tokens = Array.from(recipientsByToken.keys());

    if (tokens.length === 0) {
      return {
        tokenCount: 0,
        successCount: 0,
        failureCount: 0,
        invalidTokensRemoved: 0,
        failureReasons: {},
      };
    }

    const messaging = this.firebaseAdminService.getMessagingOrThrow();
    let successCount = 0;
    let failureCount = 0;
    const invalidTokens: string[] = [];
    const failureReasons = new Map<string, number>();

    for (const language of ["en", "es"] as const) {
      const languageTokens = recipientGroups[language];
      if (languageTokens.length === 0) {
        continue;
      }

      const resolvedMessage = this.resolveMessageForLanguage(message, language);
      const response = await messaging.sendEachForMulticast({
        tokens: languageTokens,
        notification: {
          title: resolvedMessage.title,
          body: resolvedMessage.body,
        },
        data: this.normalizeData(resolvedMessage.data),
        android: {
          priority: "high",
          notification: {
            channelId: "budgetapp_default_channel",
            sound: "default",
          },
        },
        apns: {
          payload: {
            aps: {
              sound: "default",
            },
          },
        },
      });

      successCount += response.successCount;
      failureCount += response.failureCount;

      response.responses.forEach((delivery, index) => {
        const errorCode = delivery.error?.code;
        if (!errorCode) {
          return;
        }

        failureReasons.set(errorCode, (failureReasons.get(errorCode) ?? 0) + 1);

        if (INVALID_TOKEN_CODES.has(errorCode)) {
          invalidTokens.push(languageTokens[index]);
        }
      });
    }

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
      successCount,
      failureCount,
      invalidTokensRemoved: invalidTokens.length,
      failureReasons: Object.fromEntries(failureReasons),
    };
  }

  private resolveMessageForLanguage(
    message: NotificationMessageInput,
    language: NotificationLanguage,
  ): PushMessageInput {
    if ("resolveMessage" in message) {
      return message.resolveMessage(language);
    }

    return message;
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

  private buildSubscriptionReminderMessage(
    subscription: SubscriptionReminderInput,
    language: NotificationLanguage,
  ): Pick<PushMessageInput, "title" | "body"> {
    const amount = this.formatCurrency(
      subscription.currency,
      Number(subscription.cost),
      language,
    );

    if (subscription.daysRemaining <= 0) {
      if (language === "es") {
        return {
          title: `Pago pendiente hoy: ${subscription.name}`,
          body: `${subscription.name} se cobra hoy por ${amount}.`,
        };
      }

      return {
        title: `Payment due today: ${subscription.name}`,
        body: `${subscription.name} charges ${amount} today.`,
      };
    }

    if (language === "es") {
      return {
        title: `Proximo pago: ${subscription.name}`,
        body:
          subscription.daysRemaining === 1
            ? `${subscription.name} se cobrara ${amount} en 1 dia.`
            : `${subscription.name} se cobrara ${amount} en ${subscription.daysRemaining} dias.`,
      };
    }

    return {
      title: `Upcoming payment: ${subscription.name}`,
      body:
        subscription.daysRemaining === 1
          ? `${subscription.name} will charge ${amount} in 1 day.`
          : `${subscription.name} will charge ${amount} in ${subscription.daysRemaining} days.`,
    };
  }

  private formatCurrency(
    currency: string,
    amount: number,
    language: NotificationLanguage,
  ): string {
    const locale = language === "es" ? "es-MX" : "en-US";

    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        currencyDisplay: "code",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  }

  private assertAdmin(currentUser: CurrentUserType) {
    if ((currentUser.role || "").toLowerCase() !== "admin") {
      throw new ForbiddenException(
        "Only administrators can send test push notifications",
      );
    }
  }
}
