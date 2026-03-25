import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  trimStringValue,
  trimUpperCaseStringValue,
} from "../../common/dto/string-transformers";

export const CLASSIFIED_RECORD_TYPE_VALUES = [
  "SUBSCRIPTION",
  "DAILY_EXPENSE",
] as const;

export const CLASSIFIED_BILLING_CYCLE_VALUES = [
  "MONTHLY",
  "YEARLY",
  "ONE_TIME",
] as const;

export class CreateClassifiedRecordDto {
  @ApiProperty({ enum: CLASSIFIED_RECORD_TYPE_VALUES })
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @IsIn([...CLASSIFIED_RECORD_TYPE_VALUES])
  type: string;

  @ApiProperty({ example: "Netflix" })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  merchant: string;

  @ApiProperty({ example: 299 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ example: "MXN" })
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency: string;

  @ApiProperty({ enum: CLASSIFIED_BILLING_CYCLE_VALUES })
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @IsIn([...CLASSIFIED_BILLING_CYCLE_VALUES])
  billingCycle: string;

  @ApiPropertyOptional({
    example: "2026-04-21T00:00:00.000Z",
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  nextBillingDate?: string | null;

  @ApiProperty({ example: "Entertainment" })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  category: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  isTaxable: boolean;

  @ApiProperty({
    example: "Monthly Netflix subscription for household entertainment plan renewal.",
  })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  summary: string;
}
