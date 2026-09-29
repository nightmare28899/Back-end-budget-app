import { ApiProperty } from "@nestjs/swagger";
import {
  IsDateString,
  IsNotEmpty,
  Matches,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from "class-validator";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

@ValidatorConstraint({ name: "cardExpenseDateRange", async: false })
class CardExpenseDateRangeConstraint implements ValidatorConstraintInterface {
  validate(_value: string, arguments_: ValidationArguments) {
    const range = arguments_.object as CardExpenseBreakdownQueryDto;
    if (!DATE_ONLY_PATTERN.test(range.from) || !DATE_ONLY_PATTERN.test(range.to)) {
      return true;
    }

    return Date.parse(`${range.from}T00:00:00.000Z`) <= Date.parse(`${range.to}T00:00:00.000Z`);
  }

  defaultMessage() {
    return "to must be on or after from";
  }
}

export class CardExpenseBreakdownQueryDto {
  @ApiProperty({ example: "2026-04-01" })
  @IsNotEmpty()
  @Matches(DATE_ONLY_PATTERN)
  @IsDateString({ strict: true })
  from!: string;

  @ApiProperty({ example: "2026-04-30" })
  @IsNotEmpty()
  @Matches(DATE_ONLY_PATTERN)
  @IsDateString({ strict: true })
  @Validate(CardExpenseDateRangeConstraint)
  to!: string;
}
