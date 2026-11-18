import { Module } from "@nestjs/common";
import { CardStatementsModule } from "../card-statements/card-statements.module";
import { ExpensesModule } from "../expenses/expenses.module";
import { DetectedPurchasesController } from "./detected-purchases.controller";
import { DetectedPurchasesService } from "./detected-purchases.service";
@Module({
  imports: [ExpensesModule, CardStatementsModule],
  controllers: [DetectedPurchasesController],
  providers: [DetectedPurchasesService],
})
export class DetectedPurchasesModule {}
