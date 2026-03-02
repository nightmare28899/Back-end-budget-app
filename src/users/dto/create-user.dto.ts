import { Transform, Type } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  trimLowerCaseStringValue,
  trimStringValue,
  trimUpperCaseStringValue,
} from "../../common/dto/string-transformers";

export class CreateUserDto {
  @ApiProperty({ example: "john@example.com" })
  @Transform(({ value }) => trimLowerCaseStringValue(value as unknown))
  @IsEmail()
  email: string;

  @ApiProperty({ example: "John Doe" })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: "password123", minLength: 6 })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({ example: "user", enum: ["user", "admin"] })
  @Transform(({ value }) =>
    value === undefined ? "user" : trimLowerCaseStringValue(value as unknown),
  )
  @IsOptional()
  @IsString()
  @IsIn(["user", "admin"])
  role?: string;

  @ApiPropertyOptional({ example: 500.0 })
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
