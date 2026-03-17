import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";
import {
  trimStringValue,
  trimUpperCaseStringValue,
} from "../../common/dto/string-transformers";

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

  @ApiPropertyOptional({ example: "2026-12-31" })
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @ApiPropertyOptional({ example: "airplane" })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(50)
  icon?: string;

  @ApiPropertyOptional({ example: "#3B82F6" })
  @IsOptional()
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @Matches(/^#([0-9A-F]{6})$/)
  color?: string;
}
