import { Module } from "@nestjs/common";
import { ExpensesService } from "./expenses.service";
import { ExpensesController } from "./expenses.controller";
import { CreditCardsModule } from "../credit-cards/credit-cards.module";
import { EntitlementsService } from "../common/entitlements/entitlements.service";

@Module({
  imports: [CreditCardsModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, EntitlementsService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
