import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserType } from "../common/types/current-user.type";
import { DetectedPurchasesService } from "./detected-purchases.service";
import {
  ConfirmDetectedPurchaseDto,
  DiscardDetectedPurchaseDto,
  QueryDetectedPurchasesDto,
  SyncDetectedPurchasesDto,
} from "./dto/detected-purchase.dto";
@UseGuards(JwtAuthGuard)
@Controller("detected-purchases")
export class DetectedPurchasesController {
  constructor(private readonly service: DetectedPurchasesService) {}
  @Post("sync")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  sync(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: SyncDetectedPurchasesDto,
  ) {
    return this.service.sync(user.id, dto);
  }
  @Get()
  list(
    @CurrentUser() user: CurrentUserType,
    @Query() query: QueryDetectedPurchasesDto,
  ) {
    return this.service.list(user.id, query);
  }
  @Post(":id/confirm")
  confirm(
    @CurrentUser() user: CurrentUserType,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ConfirmDetectedPurchaseDto,
  ) {
    return this.service.confirm(user.id, id, dto);
  }
  @Post(":id/discard")
  discard(
    @CurrentUser() user: CurrentUserType,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() _dto: DiscardDetectedPurchaseDto,
  ) {
    void _dto;
    return this.service.discard(user.id, id);
  }
}
