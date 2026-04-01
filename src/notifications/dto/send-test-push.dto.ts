import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsString, IsUUID, MaxLength } from "class-validator";
import { trimStringValue } from "../../common/dto/string-transformers";

export class SendTestPushDto {
  @ApiProperty({
    example: "8f4d2ea1-3d68-4b94-98ee-5a5abf71dc5c",
    description: "Target user id",
  })
  @IsUUID()
  userId: string;

  @ApiProperty({ example: "Test notification" })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(120)
  title: string;

  @ApiProperty({
    example: "This push came from the admin panel.",
    description: "Notification body shown on device",
  })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MaxLength(240)
  body: string;
}
