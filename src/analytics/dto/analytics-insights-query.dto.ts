import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsInt, IsOptional, Max, Min } from "class-validator";

export class AnalyticsInsightsQueryDto {
  @ApiPropertyOptional({
    example: "2026-04-08",
    description:
      "Reference date for the spending insights. It cannot be greater than the current date.",
  })
  @IsOptional()
  @IsDateString()
  referenceDate?: string;

  @ApiPropertyOptional({
    example: 6,
    description:
      "Projection horizon in months for subscription savings opportunities.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  horizonMonths?: number;
}
