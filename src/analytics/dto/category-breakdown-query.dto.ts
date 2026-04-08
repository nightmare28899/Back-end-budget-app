import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsOptional } from "class-validator";

export class CategoryBreakdownQueryDto {
  @ApiPropertyOptional({
    example: "2026-04-01",
    description: "Start date for the category breakdown range.",
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: "2026-04-07",
    description: "End date for the category breakdown range.",
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    example: "2026-04-07",
    description:
      "Reference date used to resolve the budget period when no explicit from/to range is provided.",
  })
  @IsOptional()
  @IsDateString()
  referenceDate?: string;
}
