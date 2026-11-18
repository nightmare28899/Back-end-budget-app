import { IsUUID } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateStatementImportDto {
  @ApiProperty({
    description: "Existing credit card associated with this statement.",
  })
  @IsUUID()
  creditCardId: string;
}
