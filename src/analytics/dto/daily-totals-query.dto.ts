import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, Max, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class DailyTotalsQueryDto {
  @ApiPropertyOptional({
    example: 7,
    minimum: 1,
    maximum: 90,
    description: "Number of days to include",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;

  @ApiPropertyOptional({
    example: "2026-04-07",
    description:
      "Anchor date for the daily window. The response includes the previous N days up to this date and cannot be in the future.",
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
