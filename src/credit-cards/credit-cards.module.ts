import { Module } from "@nestjs/common";
import { CreditCardsController } from "./credit-cards.controller";
import { CreditCardsService } from "./credit-cards.service";
import { EntitlementsService } from "../common/entitlements/entitlements.service";

@Module({
  controllers: [CreditCardsController],
  providers: [CreditCardsService, EntitlementsService],
  exports: [CreditCardsService],
})
export class CreditCardsModule {}
