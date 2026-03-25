import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  trimLowerCaseStringValue,
  trimStringValue,
  trimUpperCaseStringValue,
} from "../../common/dto/string-transformers";
import { BUDGET_PERIOD_VALUES } from "../../common/budget/budget.utils";

export class UpdateUserDto {
  @ApiPropertyOptional({ example: "John Doe" })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 500.0,
    description: "Legacy alias for budgetAmount",
    deprecated: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  dailyBudget?: number;

  @ApiPropertyOptional({
    example: 3500,
    description: "Budget amount for the selected budgetPeriod",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  budgetAmount?: number;

  @ApiPropertyOptional({
    example: "monthly",
    enum: BUDGET_PERIOD_VALUES,
    default: "daily",
  })
  @IsOptional()
  @Transform(({ value }) => trimLowerCaseStringValue(value as unknown))
  @IsString()
  @IsIn([...BUDGET_PERIOD_VALUES])
  budgetPeriod?: string;

  @ApiPropertyOptional({
    example: "2026-03-01",
    description: "Required when budgetPeriod is 'period'",
  })
  @IsOptional()
  @IsDateString()
  budgetPeriodStart?: string;

  @ApiPropertyOptional({
    example: "2026-03-31",
    description: "Required when budgetPeriod is 'period'",
  })
  @IsOptional()
  @IsDateString()
  budgetPeriodEnd?: string;

  @ApiPropertyOptional({ example: "MXN" })
  @IsOptional()
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.toLowerCase().trim();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return undefined;
  })
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: "tempPass123",
    minLength: 6,
    description: "Temporary password set by admin",
  })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MinLength(6)
  password?: string;
}
