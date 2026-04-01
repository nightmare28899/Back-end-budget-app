import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserType } from "../common/types/current-user.type";
import { NotificationsService } from "./notifications.service";
import { RegisterDeviceTokenDto } from "./dto/register-device-token.dto";
import { RemoveDeviceTokenDto } from "./dto/remove-device-token.dto";
import { SendTestPushDto } from "./dto/send-test-push.dto";

@ApiTags("Notifications")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post("device-tokens")
  @ApiOperation({ summary: "Register or refresh the current device push token" })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async registerDeviceToken(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    return this.notificationsService.registerDeviceToken(user.id, dto);
  }

  @Post("device-tokens/remove")
  @ApiOperation({ summary: "Remove the current device push token" })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async removeDeviceToken(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: RemoveDeviceTokenDto,
  ) {
    return this.notificationsService.removeDeviceToken(user.id, dto);
  }

  @Post("test-push")
  @ApiOperation({ summary: "Send a test push notification to a user's devices" })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async sendTestPush(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: SendTestPushDto,
  ) {
    return this.notificationsService.sendTestPush(user, dto);
  }
}
