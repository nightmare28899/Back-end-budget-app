import { Transform, Type } from "class-transformer";
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { trimStringValue } from "../../common/dto/string-transformers";

export class CreateCategoryDto {
  @ApiProperty({ example: "Food" })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional({ example: "🍔" })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(20)
  icon?: string;

  @ApiPropertyOptional({ example: "#FF6B6B" })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @Matches(/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
  color?: string;

  @ApiPropertyOptional({
    example: 1500,
    description:
      "Category spending cap that will be tracked inside the user's current spending plan period.",
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  budgetAmount?: number;
}
