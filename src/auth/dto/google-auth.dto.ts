import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class GoogleAuthDto {
  @ApiProperty({
    example:
      "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ.eyJhdWQiOiJidWRnZXQtYXBwIiwiZW1haWwiOiJ1c2VyQGV4YW1wbGUuY29tIn0.signature",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  firebaseIdToken: string;
}
