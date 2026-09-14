import { IsBoolean } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class MarkStatementPaidDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isPaid: boolean;
}
