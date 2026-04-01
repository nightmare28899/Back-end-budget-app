import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsString, MaxLength } from "class-validator";
import { trimStringValue, trimUpperCaseStringValue } from "../../common/dto/string-transformers";

export const DEVICE_PLATFORM_VALUES = ["ANDROID", "IOS"] as const;

export class RegisterDeviceTokenDto {
  @ApiProperty({
    example: "fM1Wg2xY...sample-token",
    description: "FCM device registration token",
  })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(4096)
  token: string;

  @ApiProperty({ example: "ANDROID", enum: DEVICE_PLATFORM_VALUES })
  @Transform(({ value }) => trimUpperCaseStringValue(value as unknown))
  @IsString()
  @IsIn([...DEVICE_PLATFORM_VALUES])
  platform: string;
}
