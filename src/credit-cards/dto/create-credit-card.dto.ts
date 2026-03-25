import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
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

export class CreateCreditCardDto {
  @ApiProperty({ example: "Nu" })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(80)
  name: string;

  @ApiProperty({ example: "Nu Bank" })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(80)
  bank: string;

  @ApiProperty({ example: "MASTERCARD" })
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @MaxLength(30)
  brand: string;

  @ApiProperty({ example: "1234" })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @Matches(/^\d{4}$/)
  last4: string;

  @ApiPropertyOptional({ example: "#7C3AED" })
  @IsOptional()
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @Matches(/^#(?:[0-9A-F]{3}|[0-9A-F]{6})$/)
  color?: string;

  @ApiPropertyOptional({ example: 25000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditLimit?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  closingDay?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  paymentDueDay?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}
