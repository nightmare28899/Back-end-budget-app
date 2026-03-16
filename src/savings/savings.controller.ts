import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserType } from "../common/types/current-user.type";
import { AddSavingsFundsDto } from "./dto/add-savings-funds.dto";
import { CreateSavingsGoalDto } from "./dto/create-savings-goal.dto";
import { SavingsService } from "./savings.service";

@ApiTags("Savings")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("savings")
export class SavingsController {
  constructor(private readonly savingsService: SavingsService) {}

  @Get("goals")
  @ApiOperation({ summary: "Get all savings goals for current user" })
  async getSavingsGoals(@CurrentUser() user: CurrentUserType) {
    return this.savingsService.getSavingsGoals(user.id);
  }

  @Post("goals")
  @ApiOperation({ summary: "Create a new savings goal" })
  async createGoal(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateSavingsGoalDto,
  ) {
    return this.savingsService.createGoal(user.id, dto.title, dto.targetAmount);
  }

  @Post("goals/:goalId/funds")
  @ApiOperation({ summary: "Add funds to an existing savings goal" })
  async addFunds(
    @CurrentUser() user: CurrentUserType,
    @Param("goalId", ParseUUIDPipe) goalId: string,
    @Body() dto: AddSavingsFundsDto,
  ) {
    return this.savingsService.addFunds(user.id, goalId, dto.amount);
  }

  @Get("goals/:goalId/transactions")
  @ApiOperation({ summary: "Get transaction history for a savings goal" })
  async getGoalTransactions(
    @CurrentUser() user: CurrentUserType,
    @Param("goalId", ParseUUIDPipe) goalId: string,
  ) {
    return this.savingsService.getGoalTransactions(user.id, goalId);
  }
}
