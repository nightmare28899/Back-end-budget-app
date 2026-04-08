import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { AnalyticsService } from "./analytics.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserType } from "../common/types/current-user.type";
import { DailyTotalsQueryDto } from "./dto/daily-totals-query.dto";
import { AnalyticsSummaryQueryDto } from "./dto/analytics-summary-query.dto";
import { CategoryBreakdownQueryDto } from "./dto/category-breakdown-query.dto";
import { AnalyticsInsightsQueryDto } from "./dto/analytics-insights-query.dto";

@ApiTags("Analytics")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get("daily")
  @ApiOperation({
    summary:
      "Get daily spending totals for the last N days up to a selected date",
  })
  @ApiQuery({ name: "days", required: false, type: Number })
  @ApiQuery({ name: "endDate", required: false, type: String })
  async getDailyTotals(
    @CurrentUser() user: CurrentUserType,
    @Query() query: DailyTotalsQueryDto,
  ) {
    return this.analyticsService.getDailyTotals(
      user.id,
      query.days ?? 7,
      query.endDate,
    );
  }

  @Get("categories")
  @ApiOperation({ summary: "Get spending breakdown by category" })
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  @ApiQuery({ name: "referenceDate", required: false, type: String })
  async getCategoryBreakdown(
    @CurrentUser() user: CurrentUserType,
    @Query() query: CategoryBreakdownQueryDto,
  ) {
    return this.analyticsService.getCategoryBreakdown(
      user.id,
      query.from,
      query.to,
      query.referenceDate,
    );
  }

  @Get("category-budgets")
  @ApiOperation({
    summary:
      "Get category budget performance for the currently configured spending plan period",
  })
  @ApiQuery({ name: "referenceDate", required: false, type: String })
  async getCategoryBudgets(
    @CurrentUser() user: CurrentUserType,
    @Query() query: AnalyticsSummaryQueryDto,
  ) {
    return this.analyticsService.getCategoryBudgets(
      user.id,
      query.referenceDate,
    );
  }

  @Get("weekly-summary")
  @ApiOperation({
    summary: "Get summary for the currently configured budget period",
  })
  @ApiQuery({ name: "referenceDate", required: false, type: String })
  async getWeeklySummary(
    @CurrentUser() user: CurrentUserType,
    @Query() query: AnalyticsSummaryQueryDto,
  ) {
    return this.analyticsService.getWeeklySummary(user.id, query.referenceDate);
  }

  @Get("budget-summary")
  @ApiOperation({
    summary: "Get summary for the currently configured budget period",
  })
  @ApiQuery({ name: "referenceDate", required: false, type: String })
  async getBudgetSummary(
    @CurrentUser() user: CurrentUserType,
    @Query() query: AnalyticsSummaryQueryDto,
  ) {
    return this.analyticsService.getBudgetSummary(user.id, query.referenceDate);
  }

  @Get("insights")
  @ApiOperation({
    summary:
      "Get actionable spending and subscription savings insights for the selected date",
  })
  @ApiQuery({ name: "referenceDate", required: false, type: String })
  @ApiQuery({ name: "horizonMonths", required: false, type: Number })
  async getInsights(
    @CurrentUser() user: CurrentUserType,
    @Query() query: AnalyticsInsightsQueryDto,
  ) {
    return this.analyticsService.getInsights(
      user.id,
      query.referenceDate,
      query.horizonMonths,
    );
  }
}
