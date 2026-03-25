import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class QueryCreditCardsDto {
  @ApiPropertyOptional({
    example: false,
    description: "Include inactive credit cards in the list response",
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  includeInactive?: boolean;
}
