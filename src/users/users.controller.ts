import {
  Controller,
  Delete,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiResponse,
} from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { UpdateUserDto } from "./dto/update-user.dto";
import { CreateUserDto } from "./dto/create-user.dto";
import { QueryUsersDto } from "./dto/query-users.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserType } from "../common/types/current-user.type";
import { buildImageUploadOptions } from "../common/upload/image-upload.config";

@ApiTags("Users")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: "Create a user (admin only)" })
  @ApiResponse({ status: 201, description: "User created successfully" })
  async create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateUserDto,
  ) {
    const createdUser = await this.usersService.create(user, dto);
    return {
      message: "User created successfully",
      user: createdUser,
    };
  }

  @Get()
  @ApiOperation({ summary: "List users" })
  async findAll(
    @CurrentUser() user: CurrentUserType,
    @Query() query: QueryUsersDto,
  ) {
    const users = await this.usersService.findAll(user, query);

    return {
      message: "Users retrieved successfully",
      count: users.length,
      users,
    };
  }

  @Get("me")
  @ApiOperation({ summary: "Get current user profile" })
  async getProfile(@CurrentUser() user: CurrentUserType) {
    const profile = await this.usersService.getProfile(user.id);

    return {
      message: "User profile retrieved successfully",
      user: profile,
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a user by id" })
  async findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
    @Query() query: QueryUsersDto,
  ) {
    const foundUser = await this.usersService.findOne(
      id,
      user,
      query.includeDisabled === true,
    );

    return {
      message: "User retrieved successfully",
      user: foundUser,
    };
  }

  @Patch("me")
  @ApiOperation({ summary: "Update current user profile / budget settings" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        dailyBudget: { type: "number", deprecated: true },
        budgetAmount: { type: "number" },
        budgetPeriod: {
          type: "string",
          enum: ["daily", "weekly", "monthly", "annual", "period"],
          default: "daily",
        },
        budgetPeriodStart: { type: "string", format: "date-time" },
        budgetPeriodEnd: { type: "string", format: "date-time" },
        currency: { type: "string" },
        avatar: { type: "string", format: "binary" },
      },
    },
  })
  @UseInterceptors(FileInterceptor("avatar", buildImageUploadOptions()))
  async updateProfile(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateUserDto,
    @UploadedFile() avatar?: Express.Multer.File,
  ) {
    const updatedUser = await this.usersService.updateProfile(user.id, dto, avatar);

    return {
      message: "User profile updated successfully",
      user: updatedUser,
    };
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a user by id" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        dailyBudget: { type: "number", deprecated: true },
        budgetAmount: { type: "number" },
        budgetPeriod: {
          type: "string",
          enum: ["daily", "weekly", "monthly", "annual", "period"],
          default: "daily",
        },
        budgetPeriodStart: { type: "string", format: "date-time" },
        budgetPeriodEnd: { type: "string", format: "date-time" },
        currency: { type: "string" },
        avatar: { type: "string", format: "binary" },
      },
    },
  })
  @UseInterceptors(FileInterceptor("avatar", buildImageUploadOptions()))
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateUserDto,
    @UploadedFile() avatar?: Express.Multer.File,
  ) {
    const updatedUser = await this.usersService.update(id, user, dto, avatar);

    return {
      message: "User updated successfully",
      user: updatedUser,
    };
  }

  @Delete("me")
  @ApiOperation({
    summary: "Disable current user account (soft delete with deletedAt flag)",
  })
  async disableMe(@CurrentUser() user: CurrentUserType) {
    const disabledUser = await this.usersService.disable(user.id, user);

    return {
      message: "User disabled successfully",
      user: disabledUser,
    };
  }

  @Delete(":id")
  @ApiOperation({
    summary: "Disable user account by id (soft delete with deletedAt flag)",
  })
  async disable(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    const disabledUser = await this.usersService.disable(id, user);

    return {
      message: "User disabled successfully",
      user: disabledUser,
    };
  }
}
