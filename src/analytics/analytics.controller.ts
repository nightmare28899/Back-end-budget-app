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

@ApiTags("Analytics")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get("daily")
  @ApiOperation({ summary: "Get daily spending totals for the last N days" })
  @ApiQuery({ name: "days", required: false, type: Number })
  async getDailyTotals(
    @CurrentUser() user: CurrentUserType,
    @Query() query: DailyTotalsQueryDto,
  ) {
    return this.analyticsService.getDailyTotals(user.id, query.days ?? 7);
  }

  @Get("categories")
  @ApiOperation({ summary: "Get spending breakdown by category" })
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  async getCategoryBreakdown(
    @CurrentUser() user: CurrentUserType,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.analyticsService.getCategoryBreakdown(user.id, from, to);
  }

  @Get("weekly-summary")
  @ApiOperation({ summary: "Get current week spending summary" })
  async getWeeklySummary(@CurrentUser() user: CurrentUserType) {
    return this.analyticsService.getWeeklySummary(user.id);
  }
}
