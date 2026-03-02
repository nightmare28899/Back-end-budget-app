import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
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
}
