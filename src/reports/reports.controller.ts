import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
  ApiBody,
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiExcludeEndpoint,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ReportsService } from "./reports.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserType } from "../common/types/current-user.type";
import { SendWeeklyReportDto } from "./dto/send-weekly-report.dto";

@ApiTags("Reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post("send-weekly")
  @ApiOperation({ summary: "Manually trigger weekly report email" })
  @ApiBody({ type: SendWeeklyReportDto, required: false })
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async sendWeeklyReport(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: SendWeeklyReportDto,
  ) {
    return this.reportsService.sendManualReport(user.id, dto?.email);
  }

  @Post("send-weekley")
  @ApiExcludeEndpoint()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async sendWeeklyReportAlias(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: SendWeeklyReportDto,
  ) {
    return this.reportsService.sendManualReport(user.id, dto?.email);
  }
}
