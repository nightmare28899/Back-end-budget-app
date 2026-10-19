import { Module } from "@nestjs/common";
import { ExpensesModule } from "../expenses/expenses.module";
import { DetectedPurchasesController } from "./detected-purchases.controller";
import { DetectedPurchasesService } from "./detected-purchases.service";
@Module({
  imports: [ExpensesModule],
  controllers: [DetectedPurchasesController],
  providers: [DetectedPurchasesService],
})
export class DetectedPurchasesModule {}
