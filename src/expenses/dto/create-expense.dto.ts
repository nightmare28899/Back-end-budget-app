import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
  Min,
  MaxLength,
  IsUUID,
  Matches,
  IsIn,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  trimStringValue,
  trimUpperCaseStringValue,
} from "../../common/dto/string-transformers";

export const PAYMENT_METHOD_VALUES = ["CASH", "CARD"] as const;

export class CreateExpenseDto {
  @ApiProperty({ example: "Coffee at Starbucks" })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 85.5 })
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  cost: number;

  @ApiPropertyOptional({
    example: "CARD",
    enum: PAYMENT_METHOD_VALUES,
    description: "Payment method used for the expense",
  })
  @IsOptional()
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @IsIn([...PAYMENT_METHOD_VALUES])
  paymentMethod?: string;

  @ApiPropertyOptional({ example: "Great latte" })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ example: "2026-02-27T12:00:00.000Z" })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    description: "Existing category ID. Required if categoryName is not sent.",
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: "Category name to create/use when categoryId is not provided.",
    example: "Food",
  })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(60)
  categoryName?: string;

  @ApiPropertyOptional({
    description: "Icon used when creating a new category by name.",
    example: "🍔",
  })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(20)
  categoryIcon?: string;

  @ApiPropertyOptional({
    description: "Color used when creating a new category by name.",
    example: "#FF6B6B",
  })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @Matches(/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
  categoryColor?: string;
}
