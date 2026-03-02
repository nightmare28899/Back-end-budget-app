import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { CategoriesService } from "./categories.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserType } from "../common/types/current-user.type";

@ApiTags("Categories")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("categories")
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @ApiOperation({ summary: "Create a new category" })
  async create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "Get all categories" })
  async findAll(@CurrentUser() user: CurrentUserType) {
    return this.categoriesService.findAll(user.id);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single category" })
  async findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.categoriesService.findOne(id, user.id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a category" })
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(id, user.id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a category" })
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.categoriesService.remove(id, user.id);
  }

  @Post("seed")
  @ApiOperation({ summary: "Seed default categories for the user" })
  async seed(@CurrentUser() user: CurrentUserType) {
    return this.categoriesService.seedDefaults(user.id);
  }
}
