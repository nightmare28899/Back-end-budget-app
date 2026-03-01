import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  trimLowerCaseStringValue,
  trimStringValue,
} from '../../common/dto/string-transformers';

export class RegisterDto {
  @ApiProperty({ example: 'john@example.com' })
  @Transform(({ value }) => trimLowerCaseStringValue(value as unknown))
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'John Doe' })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'password123', minLength: 6 })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;
}
