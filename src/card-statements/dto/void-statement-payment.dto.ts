import { Transform, Type } from "class-transformer";
import { IsInt, IsString, MaxLength, Min, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { trimStringValue } from "../../common/dto/string-transformers";

export class VoidStatementPaymentDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @ApiProperty({ maxLength: 500 })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
