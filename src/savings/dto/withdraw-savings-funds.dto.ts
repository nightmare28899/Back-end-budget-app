import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNumber, Min } from "class-validator";

export class WithdrawSavingsFundsDto {
  @ApiProperty({ example: 120 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;
}
