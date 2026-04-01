import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { StorageModule } from "./storage/storage.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { CategoriesModule } from "./categories/categories.module";
import { ExpensesModule } from "./expenses/expenses.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { ReportsModule } from "./reports/reports.module";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";
import { HistoryModule } from "./history/history.module";
import { SavingsModule } from "./savings/savings.module";
import { IntakeModule } from "./intake/intake.module";
import { CreditCardsModule } from "./credit-cards/credit-cards.module";
import { NotificationsModule } from "./notifications/notifications.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: "default",
          ttl: 60_000,
          limit: 120,
        },
      ],
    }),
    PrismaModule,
    StorageModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    ExpensesModule,
    AnalyticsModule,
    ReportsModule,
    NotificationsModule,
    SubscriptionsModule,
    CreditCardsModule,
    HistoryModule,
    SavingsModule,
    IntakeModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
