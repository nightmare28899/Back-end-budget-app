import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  Matches,
  Min,
  ValidateIf,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class MarkStatementPaidDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isPaid: boolean;

  @ApiPropertyOptional({
    example: 4199.31,
    description: "Amount paid toward this statement. Required when isPaid is true.",
  })
  @ValidateIf((dto: MarkStatementPaidDto) => dto.isPaid === true)
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion?: number;

  @ApiPropertyOptional({ example: "MXN" })
  @IsOptional()
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}
