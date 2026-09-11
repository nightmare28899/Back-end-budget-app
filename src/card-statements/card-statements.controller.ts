import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { CurrentUserType } from "../common/types/current-user.type";
import { buildStatementUploadOptions } from "../common/upload/statement-upload.config";
import { CardStatementsService } from "./card-statements.service";
import { ConfirmStatementImportDto } from "./dto/confirm-statement-import.dto";
import { CreateStatementImportDto } from "./dto/create-statement-import.dto";
import { QueryStatementImportsDto } from "./dto/query-statement-imports.dto";
import { UpdateStatementRowsDto } from "./dto/update-statement-rows.dto";

@ApiTags("Statement imports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("statement-imports")
export class CardStatementsController {
  constructor(private readonly cardStatementsService: CardStatementsService) {}

  @Post()
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload a PDF credit-card statement" })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor("file", buildStatementUploadOptions()))
  create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateStatementImportDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.cardStatementsService.createImport(user.id, dto, file);
  }

  @Get()
  @ApiOperation({ summary: "List the current user's statement imports" })
  findAll(
    @CurrentUser() user: CurrentUserType,
    @Query() query: QueryStatementImportsDto,
  ) {
    return this.cardStatementsService.findAll(user.id, query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a statement import review preview" })
  findOne(
    @CurrentUser() user: CurrentUserType,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.cardStatementsService.findOne(user.id, id);
  }

  @Patch(":id/rows")
  @ApiOperation({ summary: "Edit statement row review decisions" })
  updateRows(
    @CurrentUser() user: CurrentUserType,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatementRowsDto,
  ) {
    return this.cardStatementsService.updateRows(user.id, id, dto);
  }

  @Post(":id/confirm")
  @ApiOperation({ summary: "Confirm reviewed rows atomically as expenses" })
  confirm(
    @CurrentUser() user: CurrentUserType,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ConfirmStatementImportDto,
  ) {
    return this.cardStatementsService.confirm(user.id, id, dto);
  }

  @Post(":id/process")
  @ApiOperation({ summary: "Process or retry an uploaded Banamex statement" })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  process(
    @CurrentUser() user: CurrentUserType,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.cardStatementsService.processStoredImport(user.id, id);
  }

  @Post(":id/revert")
  @ApiOperation({ summary: "Revert expenses created by a statement import" })
  revert(
    @CurrentUser() user: CurrentUserType,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ConfirmStatementImportDto,
  ) {
    return this.cardStatementsService.revert(user.id, id, dto);
  }
}
