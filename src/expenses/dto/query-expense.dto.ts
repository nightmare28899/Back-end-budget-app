import { Transform } from "class-transformer";
import {
  IsOptional,
  IsString,
  IsDateString,
  IsUUID,
  MaxLength,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { trimStringValue } from "../../common/dto/string-transformers";

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
  @IsUUID()
  categoryId?: string;
}
