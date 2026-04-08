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
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserType } from "../common/types/current-user.type";
import { CreateIncomeDto } from "./dto/create-income.dto";
import { UpdateIncomeDto } from "./dto/update-income.dto";
import { QueryIncomeDto } from "./dto/query-income.dto";
import { IncomeSummaryQueryDto } from "./dto/income-summary-query.dto";
import { IncomesService } from "./incomes.service";

@ApiTags("Incomes")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("incomes")
export class IncomesController {
  constructor(private readonly incomesService: IncomesService) {}

  @Post()
  @ApiOperation({ summary: "Create a new income record" })
  async create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateIncomeDto,
  ) {
    return this.incomesService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "List income records" })
  async findAll(
    @CurrentUser() user: CurrentUserType,
    @Query() query: QueryIncomeDto,
  ) {
    return this.incomesService.findAll(user.id, query);
  }

  @Get("summary")
  @ApiOperation({
    summary:
      "Get income, spending, and net cashflow for the selected budget period",
  })
  @ApiQuery({ name: "referenceDate", required: false, type: String })
  async getSummary(
    @CurrentUser() user: CurrentUserType,
    @Query() query: IncomeSummaryQueryDto,
  ) {
    return this.incomesService.getSummary(user.id, query.referenceDate);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update an income record" })
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateIncomeDto,
  ) {
    return this.incomesService.update(id, user.id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete an income record" })
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.incomesService.remove(id, user.id);
  }
}
