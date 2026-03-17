import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserType } from "../common/types/current-user.type";
import { AddSavingsFundsDto } from "./dto/add-savings-funds.dto";
import { CreateSavingsGoalDto } from "./dto/create-savings-goal.dto";
import { UpdateSavingsGoalDto } from "./dto/update-savings-goal.dto";
import { WithdrawSavingsFundsDto } from "./dto/withdraw-savings-funds.dto";
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
    return this.savingsService.createGoal(user.id, dto);
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

  @Post("goals/:goalId/withdraw")
  @ApiOperation({ summary: "Withdraw funds from an existing savings goal" })
  async withdrawFunds(
    @CurrentUser() user: CurrentUserType,
    @Param("goalId", ParseUUIDPipe) goalId: string,
    @Body() dto: WithdrawSavingsFundsDto,
  ) {
    return this.savingsService.withdrawFunds(user.id, goalId, dto.amount);
  }

  @Patch("goals/:goalId")
  @ApiOperation({ summary: "Update an existing savings goal" })
  async updateGoal(
    @CurrentUser() user: CurrentUserType,
    @Param("goalId", ParseUUIDPipe) goalId: string,
    @Body() dto: UpdateSavingsGoalDto,
  ) {
    return this.savingsService.updateGoal(user.id, goalId, dto);
  }

  @Delete("goals/:goalId")
  @ApiOperation({ summary: "Delete a savings goal when current amount is 0" })
  async deleteGoal(
    @CurrentUser() user: CurrentUserType,
    @Param("goalId", ParseUUIDPipe) goalId: string,
  ) {
    return this.savingsService.deleteGoal(user.id, goalId);
  }
}
