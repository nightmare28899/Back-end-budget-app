import { Transform, Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { trimStringValue } from "../../common/dto/string-transformers";
import { IsCategoryId } from "../../common/dto/category-id.decorator";

export class LocationSuggestionQueryDto {
  @ApiPropertyOptional({
    description: "Merchant/location text used to match recurring purchases",
    example: "Starbucks Reforma",
  })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(120)
  locationLabel: string;

  @ApiPropertyOptional({
    description: "Optional category restriction",
  })
  @IsOptional()
  @IsCategoryId()
  categoryId?: string;

  @ApiPropertyOptional({
    description: "Optional title text search within matched location",
    example: "latte",
  })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({
    example: 5,
    minimum: 1,
    maximum: 10,
    default: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}
