import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ReportsService } from "./reports.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserType } from "../common/types/current-user.type";
import { SendWeeklyReportDto } from "./dto/send-weekly-report.dto";
import { ReportHistoryQueryDto } from "./dto/report-history-query.dto";
import { ReportSummaryQueryDto } from "./dto/report-summary-query.dto";
import { SendReportDto } from "./dto/send-report.dto";

@ApiTags("Reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get("summary")
  @ApiOperation({
    summary: "Get a weekly or monthly in-app report snapshot",
  })
  @ApiQuery({
    name: "periodType",
    required: false,
    enum: ["weekly", "monthly"],
  })
  @ApiQuery({ name: "referenceDate", required: false, type: String })
  @ApiQuery({ name: "horizonMonths", required: false, type: Number })
  async getSummary(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ReportSummaryQueryDto,
  ) {
    return this.reportsService.getSummary(user.id, {
      periodType: query.periodType,
      referenceDate: query.referenceDate,
      horizonMonths: query.horizonMonths,
    });
  }

  @Get("history")
  @ApiOperation({
    summary: "Get the most recent saved or emailed reports",
  })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getHistory(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ReportHistoryQueryDto,
  ) {
    return this.reportsService.getHistory(user.id, query.limit);
  }

  @Post("history")
  @ApiOperation({
    summary: "Save the current weekly or monthly report snapshot to history",
  })
  @ApiBody({ type: ReportSummaryQueryDto, required: false })
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async saveSummary(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: ReportSummaryQueryDto,
  ) {
    return this.reportsService.saveSummary(user.id, {
      periodType: dto?.periodType,
      referenceDate: dto?.referenceDate,
      horizonMonths: dto?.horizonMonths,
      source: "manual",
    });
  }

  @Post("send")
  @ApiOperation({
    summary: "Send a weekly or monthly report email for the selected date",
  })
  @ApiBody({ type: SendReportDto, required: false })
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async sendReport(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: SendReportDto,
  ) {
    return this.reportsService.sendManualReport(user.id, {
      email: dto?.email,
      periodType: dto?.periodType,
      referenceDate: dto?.referenceDate,
      horizonMonths: dto?.horizonMonths,
    });
  }

  @Post("send-weekly")
  @ApiOperation({ summary: "Manually trigger budget report email" })
  @ApiBody({ type: SendWeeklyReportDto, required: false })
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async sendWeeklyReport(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: SendWeeklyReportDto,
  ) {
    return this.reportsService.sendManualReport(user.id, {
      email: dto?.email,
      periodType: "weekly",
    });
  }
}
