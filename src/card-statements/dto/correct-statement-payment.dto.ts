import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { trimStringValue } from "../../common/dto/string-transformers";
import { CreateStatementPaymentDto } from "./create-statement-payment.dto";

export class CorrectStatementPaymentDto extends CreateStatementPaymentDto {
  @ApiProperty({ maxLength: 500 })
  @Transform(({ value }) => trimStringValue(value as unknown))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
