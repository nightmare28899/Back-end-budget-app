import { Transform, Type } from "class-transformer";
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  trimLowerCaseStringValue,
  trimStringValue,
  trimUpperCaseStringValue,
} from "../../common/dto/string-transformers";
import { BUDGET_PERIOD_VALUES } from "../../common/budget/budget.utils";

export class CreateUserDto {
  @ApiProperty({ example: "john@example.com" })
  @Transform(({ value }) => trimLowerCaseStringValue(value as unknown))
  @IsEmail()
  email: string;

  @ApiProperty({ example: "John Doe" })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: "password123", minLength: 6 })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({ example: "user", enum: ["user", "admin"] })
  @Transform(({ value }) =>
    value === undefined ? "user" : trimLowerCaseStringValue(value as unknown),
  )
  @IsOptional()
  @IsString()
  @IsIn(["user", "admin"])
  role?: string;

  @ApiPropertyOptional({
    example: 500,
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
    example: "weekly",
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
}
