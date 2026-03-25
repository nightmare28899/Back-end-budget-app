import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserType } from "../common/types/current-user.type";
import { CreateClassifiedRecordDto } from "./dto/create-classified-record.dto";
import { IntakeService } from "./intake.service";

@ApiTags("Intake")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("intake")
export class IntakeController {
  constructor(private readonly intakeService: IntakeService) {}

  @Post("classified-records")
  @ApiOperation({
    summary:
      "Create an expense or subscription directly from classifier output",
  })
  async createFromClassification(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateClassifiedRecordDto,
  ) {
    return this.intakeService.createFromClassification(user.id, dto);
  }
}
