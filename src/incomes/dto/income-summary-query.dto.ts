import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsISO8601, IsOptional, Matches } from "class-validator";

export class IncomeSummaryQueryDto {
  @ApiPropertyOptional({ example: "2026-04-08" })
  @IsOptional()
  @IsISO8601()
  referenceDate?: string;

  @ApiPropertyOptional({
    example: "MXN",
    description:
      "ISO 4217 code. When set, totals only include this currency and other currencies are listed separately.",
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{3}$/, { message: "currency must be a 3-letter ISO code" })
  currency?: string;
}
