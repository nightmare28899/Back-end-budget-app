import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from "class-validator";
import { REPORT_PERIOD_TYPES, type ReportPeriodType } from "../reports.types";

export class ReportSummaryQueryDto {
  @ApiPropertyOptional({
    enum: REPORT_PERIOD_TYPES,
    example: "weekly",
    description:
      "Report period. Weekly uses the current week up to the selected date; monthly uses the current month up to the selected date.",
  })
  @IsOptional()
  @IsIn(REPORT_PERIOD_TYPES)
  periodType?: ReportPeriodType;

  @ApiPropertyOptional({
    example: "2026-04-08",
    description:
      "Reference date for the report. It cannot be greater than the current date.",
  })
  @IsOptional()
  @IsDateString()
  referenceDate?: string;

  @ApiPropertyOptional({
    example: 6,
    description:
      "Projection horizon in months for subscription savings insights inside the report.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  horizonMonths?: number;
}
