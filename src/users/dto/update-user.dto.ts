import {
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Matches,
  MaxLength,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  trimStringValue,
  trimUpperCaseStringValue,
} from "../../common/dto/string-transformers";

export class UpdateUserDto {
  @ApiPropertyOptional({ example: "John Doe" })
  @IsOptional()
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 500.0, description: "Daily spending budget" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  dailyBudget?: number;

  @ApiPropertyOptional({ example: "MXN" })
  @IsOptional()
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}
