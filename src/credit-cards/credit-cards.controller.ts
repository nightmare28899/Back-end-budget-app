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
}
