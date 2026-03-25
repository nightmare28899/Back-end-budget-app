import { Module } from "@nestjs/common";
import { ExpensesModule } from "../expenses/expenses.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { IntakeController } from "./intake.controller";
import { IntakeService } from "./intake.service";

@Module({
  imports: [ExpensesModule, SubscriptionsModule],
  controllers: [IntakeController],
  providers: [IntakeService],
})
export class IntakeModule {}
