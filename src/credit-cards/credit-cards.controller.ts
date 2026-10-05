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
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserType } from "../common/types/current-user.type";
import { CreditCardsService } from "./credit-cards.service";
import { CreateCreditCardDto } from "./dto/create-credit-card.dto";
import { UpdateCreditCardDto } from "./dto/update-credit-card.dto";
import { QueryCreditCardsDto } from "./dto/query-credit-cards.dto";

@ApiTags("Credit Cards")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("credit-cards")
export class CreditCardsController {
  constructor(private readonly creditCardsService: CreditCardsService) {}

  @Post()
  @ApiOperation({ summary: "Create a credit card catalog entry" })
  async create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateCreditCardDto,
  ) {
    return this.creditCardsService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the current user's credit cards" })
  async findAll(
    @CurrentUser() user: CurrentUserType,
    @Query() query: QueryCreditCardsDto,
  ) {
    return this.creditCardsService.findAll(user.id, query);
  }

  @Get("overview")
  @ApiOperation({ summary: "Get credit card usage and schedule overview" })
  async getOverview(
    @CurrentUser() user: CurrentUserType,
    @Query() query: QueryCreditCardsDto,
  ) {
    return this.creditCardsService.getOverview(user.id, query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one credit card catalog entry" })
  async findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.creditCardsService.findOne(id, user.id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a credit card catalog entry" })
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateCreditCardDto,
  ) {
    return this.creditCardsService.update(id, user.id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Deactivate a credit card catalog entry" })
  async deactivate(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.creditCardsService.deactivate(id, user.id);
  }

  @Delete(":id/permanent")
  @ApiOperation({
    summary: "Permanently delete a credit card catalog entry",
    description:
      "Linked expenses and subscriptions are unlinked (creditCardId set to null). Returns 409 CREDIT_CARD_HAS_STATEMENTS when statements reference the card.",
  })
  @ApiResponse({ status: 200, description: "Credit card deleted" })
  @ApiResponse({ status: 404, description: "Credit card not found" })
  @ApiResponse({
    status: 409,
    description: "Credit card has statements (CREDIT_CARD_HAS_STATEMENTS)",
  })
  async deletePermanently(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.creditCardsService.deletePermanently(id, user.id);
  }
}
