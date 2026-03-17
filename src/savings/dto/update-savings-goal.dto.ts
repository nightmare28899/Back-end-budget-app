import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { trimStringValue } from "../../common/dto/string-transformers";

export class UpdateSavingsGoalDto {
  @ApiPropertyOptional({ example: "Emergency Fund" })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ example: 8000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  targetAmount?: number;
}
