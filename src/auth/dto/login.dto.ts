import { Transform } from "class-transformer";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { trimLowerCaseStringValue } from "../../common/dto/string-transformers";

export class LoginDto {
  @ApiProperty({ example: "john@example.com" })
  @Transform(({ value }) => trimLowerCaseStringValue(value as unknown))
  @IsEmail()
  email: string;

  @ApiProperty({ example: "password123" })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;
}
