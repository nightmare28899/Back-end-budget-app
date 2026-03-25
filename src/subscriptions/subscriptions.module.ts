import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SubscriptionsService } from "./subscriptions.service";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsWorkerService } from "./subscriptions.worker.service";
import { CreditCardsModule } from "../credit-cards/credit-cards.module";

@Module({
  imports: [PrismaModule, CreditCardsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionsWorkerService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
