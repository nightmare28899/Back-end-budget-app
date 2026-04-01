import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsString, MaxLength } from "class-validator";
import { trimStringValue } from "../../common/dto/string-transformers";

export class RemoveDeviceTokenDto {
  @ApiProperty({
    example: "fM1Wg2xY...sample-token",
    description: "FCM device registration token to remove",
  })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(4096)
  token: string;
}
