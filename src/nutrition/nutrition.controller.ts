import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { CurrentUserType } from "../common/types/current-user.type";
import {
  MAX_IMPORT_FILES,
  MAX_IMPORT_UPLOAD_SIZE,
} from "./diet-import/diet-import.files";
import { DietImportService } from "./diet-import/diet-import.service";
import { RecipeSuggestionsDto } from "./dto/recipe-suggestions.dto";
import { RecipeSuggestionsService } from "./recipe-suggestions/recipe-suggestions.service";
import { NutritionCommandDto } from "./dto/nutrition-command.dto";
import {
  buildOriginalUploadOptions,
  encodeContentDispositionFilename,
} from "./nutrition-original";
import { NutritionService } from "./nutrition.service";

@ApiTags("Nutrition")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("nutrition")
export class NutritionController {
  constructor(
    private readonly nutritionService: NutritionService,
    private readonly dietImportService: DietImportService,
    private readonly recipeSuggestions: RecipeSuggestionsService,
  ) {}

  @Get("state")
  @ApiOperation({ summary: "Get the current user's nutrition workspace" })
  getState(@CurrentUser() user: CurrentUserType) {
    return this.nutritionService.getState(user.id);
  }

  @Post("commands")
  @ApiOperation({ summary: "Run a nutrition command for the current user" })
  runCommand(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: NutritionCommandDto,
  ) {
    return this.nutritionService.runCommand(user.id, dto.command, dto.payload);
  }

  @Post("diets/:dietId/original")
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Retain the original JPG, PNG or PDF of a diet" })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor("file", buildOriginalUploadOptions()))
  uploadOriginal(
    @CurrentUser() user: CurrentUserType,
    @Param("dietId", ParseUUIDPipe) dietId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.nutritionService.storeOriginal(user.id, dietId, file);
  }

  @Post("diet-imports")
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary:
      "Extract a draft diet from 1-3 photos or one PDF (nothing is saved)",
  })
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @UseInterceptors(
    FilesInterceptor("files", MAX_IMPORT_FILES, {
      limits: { fileSize: MAX_IMPORT_UPLOAD_SIZE, files: MAX_IMPORT_FILES },
    }),
  )
  importDiet(@UploadedFiles() files?: Express.Multer.File[]) {
    return this.dietImportService.importDiet(files);
  }

  @Post("recipe-suggestions")
  @ApiOperation({
    summary:
      "Generate recipe drafts for a diet option with AI (nothing is saved)",
  })
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  suggestRecipes(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: RecipeSuggestionsDto,
  ) {
    return this.recipeSuggestions.suggest(user.id, dto);
  }

  @Get("files/:id")
  @ApiOperation({ summary: "Download a retained diet original" })
  async download(
    @CurrentUser() user: CurrentUserType,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.nutritionService.getOriginal(user.id, id);

    response.setHeader("Content-Type", file.mime);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeContentDispositionFilename(file.name)}`,
    );
    if (file.contentLength !== null) {
      response.setHeader("Content-Length", String(file.contentLength));
    }
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");

    return new StreamableFile(file.stream);
  }
}
