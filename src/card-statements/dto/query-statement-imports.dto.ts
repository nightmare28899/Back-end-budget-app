import { StatementImportStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class QueryStatementImportsDto {
  @ApiPropertyOptional({ enum: StatementImportStatus })
  @IsOptional()
  @IsEnum(StatementImportStatus)
  status?: StatementImportStatus;

  @ApiPropertyOptional({ description: "Filter to imports linked to this credit card" })
  @IsOptional()
  @IsUUID()
  creditCardId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
