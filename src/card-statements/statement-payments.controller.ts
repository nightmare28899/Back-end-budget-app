import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { CurrentUserType } from "../common/types/current-user.type";
import { CorrectStatementPaymentDto } from "./dto/correct-statement-payment.dto";
import { VoidStatementPaymentDto } from "./dto/void-statement-payment.dto";
import { StatementPaymentsService } from "./statement-payments.service";

@ApiTags("Statement payments")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("statement-payments")
export class StatementPaymentsController {
  constructor(private readonly paymentsService: StatementPaymentsService) {}

  @Post(":id/corrections")
  @ApiOperation({
    summary: "Correct a statement payment without deleting history",
  })
  correct(
    @CurrentUser() user: CurrentUserType,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CorrectStatementPaymentDto,
  ) {
    return this.paymentsService.correct(user.id, id, dto);
  }

  @Post(":id/void")
  @ApiOperation({
    summary: "Void a statement payment without deleting history",
  })
  void(
    @CurrentUser() user: CurrentUserType,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: VoidStatementPaymentDto,
  ) {
    return this.paymentsService.void(user.id, id, dto);
  }
}
