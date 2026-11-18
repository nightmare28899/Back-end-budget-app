import { Transform, Type } from "class-transformer";
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { trimStringValue } from "../../common/dto/string-transformers";

export class CreateStatementPaymentDto {
  @ApiProperty({ minimum: 0.01, example: 1500.25 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999999999.99)
  amount: number;

  @ApiProperty({ example: "MXN" })
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @Matches(/^[A-Z]{3}$/)
  currency: string;

  @ApiProperty({ example: "2026-09-29T12:00:00.000Z" })
  @IsDateString()
  paidAt: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(({ value }) => {
    const trimmed = trimStringValue(value as unknown);
    return trimmed === "" ? undefined : trimmed;
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note?: string;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @ApiProperty()
  @IsUUID()
  idempotencyKey: string;
}
