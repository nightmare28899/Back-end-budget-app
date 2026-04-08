import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import { parseOptionalBooleanValue } from "../../common/dto/boolean-transformers";

export class GoogleAuthDto {
  @ApiProperty({
    example:
      "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ.eyJhdWQiOiJidWRnZXQtYXBwIiwiZW1haWwiOiJ1c2VyQGV4YW1wbGUuY29tIn0.signature",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  firebaseIdToken: string;

  @ApiPropertyOptional({
    example: true,
    description:
      "Whether the client presented and collected acceptance of the current Terms and Conditions before Google sign-in.",
  })
  @Transform(({ value }) => parseOptionalBooleanValue(value as unknown))
  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;
}
