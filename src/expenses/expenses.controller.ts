import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserType } from '../common/types/current-user.type';
import { buildImageUploadOptions } from '../common/upload/image-upload.config';

@ApiTags('Expenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new expense with optional receipt image' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', buildImageUploadOptions()))
  async create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateExpenseDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.expensesService.create(user.id, dto, file);
  }

  @Get('today')
  @ApiOperation({ summary: "Get today's expenses with budget summary" })
  async findToday(@CurrentUser() user: CurrentUserType) {
    return this.expensesService.findToday(user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Search and filter expense history' })
  async findAll(
    @CurrentUser() user: CurrentUserType,
    @Query() query: QueryExpenseDto,
  ) {
    return this.expensesService.findAll(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single expense detail' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.expensesService.findOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an expense' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expensesService.update(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an expense' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.expensesService.remove(id, user.id);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Batch sync offline expenses' })
  async sync(
    @CurrentUser() user: CurrentUserType,
    @Body() expenses: CreateExpenseDto[],
  ) {
    return this.expensesService.syncBatch(user.id, expenses);
  }
}
