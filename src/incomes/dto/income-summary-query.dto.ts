import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional } from "class-validator";

export class IncomeSummaryQueryDto {
  @ApiPropertyOptional({ example: "2026-04-08" })
  @IsOptional()
  @IsISO8601()
  referenceDate?: string;
}
