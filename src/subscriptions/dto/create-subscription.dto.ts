import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  trimStringValue,
  trimUpperCaseStringValue,
} from "../../common/dto/string-transformers";

export const BILLING_CYCLE_VALUES = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
] as const;

export const PAYMENT_METHOD_VALUES = ["CASH", "CARD"] as const;

export class CreateSubscriptionDto {
  @ApiProperty({ example: "Netflix" })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 299, description: "Subscription cost amount" })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost: number;

  @ApiPropertyOptional({
    example: "CARD",
    enum: PAYMENT_METHOD_VALUES,
    default: "CARD",
  })
  @IsOptional()
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @IsIn([...PAYMENT_METHOD_VALUES])
  paymentMethod?: string;

  @ApiPropertyOptional({ example: "MXN", default: "MXN" })
  @IsOptional()
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiProperty({
    example: "MONTHLY",
    enum: BILLING_CYCLE_VALUES,
    default: "MONTHLY",
  })
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @IsIn([...BILLING_CYCLE_VALUES])
  billingCycle: string;

  @ApiProperty({
    example: "2026-04-01T00:00:00.000Z",
    description: "Must be a future date",
  })
  @IsDateString()
  nextPaymentDate: string;

  @ApiPropertyOptional({
    example: 3,
    default: 3,
    description: "Days before nextPaymentDate to send reminder",
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  reminderDays?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @Type(() => Boolean)
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: "https://cdn.example.com/netflix.png" })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional({ example: "#E50914" })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @Matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
  hexColor?: string;
}
