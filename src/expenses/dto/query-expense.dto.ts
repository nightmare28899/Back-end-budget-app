import { Transform, Type } from "class-transformer";
import {
  IsOptional,
  IsString,
  IsDateString,
  MaxLength,
  IsInt,
  Min,
  Max,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { trimStringValue } from "../../common/dto/string-transformers";
import { IsCategoryId } from "../../common/dto/category-id.decorator";

export class QueryExpenseDto {
  @ApiPropertyOptional({ example: "2026-02-01" })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: "2026-02-28" })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ example: "coffee" })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ description: "Category ID filter" })
  @IsOptional()
  @IsCategoryId()
  categoryId?: string;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
