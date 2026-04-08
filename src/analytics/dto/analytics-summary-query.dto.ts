import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsOptional } from "class-validator";

export class AnalyticsSummaryQueryDto {
  @ApiPropertyOptional({
    example: "2026-04-07",
    description:
      "Reference date used to resolve the budget period summary. Cannot be in the future.",
  })
  @IsOptional()
  @IsDateString()
  referenceDate?: string;
}
