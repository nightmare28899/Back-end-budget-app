import { Transform } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  trimLowerCaseStringValue,
  trimStringValue,
} from "../../common/dto/string-transformers";

export class RegisterDto {
  @ApiProperty({ example: "john@example.com" })
  @Transform(({ value }) => trimLowerCaseStringValue(value as unknown))
  @IsEmail()
  email: string;

  @ApiProperty({ example: "John Doe" })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: "password123", minLength: 6 })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({ example: "user", default: "user" })
  @Transform(({ value }) =>
    value === undefined ? "user" : trimLowerCaseStringValue(value as unknown),
  )
  @IsOptional()
  @IsString()
  @IsIn(["user"])
  role?: string;
}
