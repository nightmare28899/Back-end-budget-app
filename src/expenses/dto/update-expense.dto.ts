import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateExpenseDto } from './create-expense.dto';

class UpdatableExpenseFieldsDto extends OmitType(CreateExpenseDto, [
  'categoryName',
  'categoryIcon',
  'categoryColor',
] as const) {}

export class UpdateExpenseDto extends PartialType(UpdatableExpenseFieldsDto) {}
