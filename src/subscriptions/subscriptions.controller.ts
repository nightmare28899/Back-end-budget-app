import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserType } from "../common/types/current-user.type";
import { CreateSubscriptionDto } from "./dto/create-subscription.dto";
import { UpcomingSubscriptionsQueryDto } from "./dto/upcoming-subscriptions-query.dto";
import { UpdateSubscriptionDto } from "./dto/update-subscription.dto";
import { SubscriptionsService } from "./subscriptions.service";
import { SubscriptionsWorkerService } from "./subscriptions.worker.service";

@ApiTags("Subscriptions")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("subscriptions")
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly subscriptionsWorkerService: SubscriptionsWorkerService,
  ) {}

  @Post()
  @ApiOperation({ summary: "Create a recurring subscription" })
  async create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.subscriptionsService.create(user.id, dto);
  }

  @Get("projection")
  @ApiOperation({
    summary: "Get monthly projection from all active subscriptions",
  })
  async getProjection(@CurrentUser() user: CurrentUserType) {
    return this.subscriptionsService.getMonthlyProjection(user.id);
  }

  @Get("upcoming")
  @ApiOperation({
    summary: "List subscriptions due within the next N days (default: 3)",
  })
  @ApiQuery({ name: "days", required: false, type: Number, example: 3 })
  async findUpcoming(
    @CurrentUser() user: CurrentUserType,
    @Query() query: UpcomingSubscriptionsQueryDto,
  ) {
    return this.subscriptionsService.findUpcoming(user.id, query.days ?? 3);
  }

  @Post("process-subscriptions")
  @ApiOperation({
    summary: "Manually trigger process_subscriptions for the current user",
  })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async processSubscriptionsNow(@CurrentUser() user: CurrentUserType) {
    return this.subscriptionsWorkerService.processDueSubscriptions(
      new Date(),
      user.id,
    );
  }

  @Get()
  @ApiOperation({
    summary: "List subscriptions ordered by next payment date (soonest first)",
  })
  async findAll(@CurrentUser() user: CurrentUserType) {
    return this.subscriptionsService.findAll(user.id);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a subscription by id" })
  async findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.subscriptionsService.findOne(id, user.id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update subscription fields or deactivate it" })
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.subscriptionsService.update(id, user.id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Deactivate (cancel) a subscription" })
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.subscriptionsService.remove(id, user.id);
  }
}
