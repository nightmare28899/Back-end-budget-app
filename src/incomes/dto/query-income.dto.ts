import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional, IsString, MaxLength } from "class-validator";

export class QueryIncomeDto {
  @ApiPropertyOptional({ example: "2026-04-01" })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: "2026-04-30" })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ example: "salary" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
