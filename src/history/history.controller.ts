import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { CurrentUserType } from "../common/types/current-user.type";
import { HistoryService } from "./history.service";

@ApiTags("History")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("history")
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  @ApiOperation({
    summary: "Get full user history with expenses and subscriptions",
  })
  async getHistory(@CurrentUser() user: CurrentUserType) {
    return this.historyService.getHistory(user.id);
  }
}
