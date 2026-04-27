import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import {
  trimStringValue,
  trimUpperCaseStringValue,
} from "../../common/dto/string-transformers";
import {
  coerceNotificationLanguage,
  NOTIFICATION_LANGUAGE_VALUES,
} from "../notification-language";

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

  @ApiProperty({
    example: "es",
    enum: NOTIFICATION_LANGUAGE_VALUES,
    required: false,
    description:
      "Current in-app language for this device token. Falls back to English when omitted.",
  })
  @IsOptional()
  @Transform(({ value }) => coerceNotificationLanguage(value as unknown))
  @IsString()
  @IsIn([...NOTIFICATION_LANGUAGE_VALUES])
  language?: string;
}
