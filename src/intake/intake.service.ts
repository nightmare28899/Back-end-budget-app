import { BadRequestException, Injectable } from "@nestjs/common";
import { CreateExpenseDto } from "../expenses/dto/create-expense.dto";
import { ExpensesService } from "../expenses/expenses.service";
import { CreateSubscriptionDto } from "../subscriptions/dto/create-subscription.dto";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { CreateClassifiedRecordDto } from "./dto/create-classified-record.dto";

@Injectable()
export class IntakeService {
  constructor(
    private readonly expensesService: ExpensesService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async createFromClassification(
    userId: string,
    dto: CreateClassifiedRecordDto,
  ) {
    if (dto.type === "DAILY_EXPENSE") {
      this.assertDailyExpenseShape(dto);

      const expenseDto: CreateExpenseDto = {
        title: dto.merchant,
        cost: dto.amount,
        currency: dto.currency,
        note: dto.summary,
        categoryName: dto.category,
      };

      const record = await this.expensesService.create(userId, expenseDto);

      return {
        type: dto.type,
        destination: "expenses",
        record,
      };
    }

    this.assertSubscriptionShape(dto);

    const subscriptionDto: CreateSubscriptionDto = {
      name: dto.merchant,
      cost: dto.amount,
      currency: dto.currency,
      billingCycle: dto.billingCycle,
      nextPaymentDate: dto.nextBillingDate as string,
    };

    const record = await this.subscriptionsService.create(
      userId,
      subscriptionDto,
    );

    return {
      type: dto.type,
      destination: "subscriptions",
      record,
    };
  }

  private assertDailyExpenseShape(dto: CreateClassifiedRecordDto) {
    if (dto.billingCycle !== "ONE_TIME") {
      throw new BadRequestException(
        "DAILY_EXPENSE records must use billingCycle=ONE_TIME",
      );
    }

    if (dto.nextBillingDate) {
      throw new BadRequestException(
        "DAILY_EXPENSE records cannot include nextBillingDate",
      );
    }
  }

  private assertSubscriptionShape(dto: CreateClassifiedRecordDto) {
    if (dto.billingCycle === "ONE_TIME") {
      throw new BadRequestException(
        "SUBSCRIPTION records must use MONTHLY or YEARLY billingCycle",
      );
    }

    if (!dto.nextBillingDate) {
      throw new BadRequestException(
        "SUBSCRIPTION records must include nextBillingDate",
      );
    }
  }
}
