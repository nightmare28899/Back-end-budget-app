import { Type } from "class-transformer";
import { IsInt, Min } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class ConfirmStatementImportDto {
  @ApiProperty({ minimum: 1, example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;
}
