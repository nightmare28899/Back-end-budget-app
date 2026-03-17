import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsDateString,
  IsNotEmpty,
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

export class CreateSavingsGoalDto {
  @ApiProperty({ example: "Emergency Fund" })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 5000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  targetAmount: number;

  @ApiProperty({ required: false, example: "2026-12-31" })
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @ApiProperty({ required: false, example: "airplane" })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(50)
  icon?: string;

  @ApiProperty({ required: false, example: "#3B82F6" })
  @IsOptional()
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @Matches(/^#([0-9A-F]{6})$/)
  color?: string;
}
