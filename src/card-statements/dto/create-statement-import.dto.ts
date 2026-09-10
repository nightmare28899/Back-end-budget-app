import { IsOptional, IsUUID } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class CreateStatementImportDto {
  @ApiPropertyOptional({
    description: "Existing credit card associated with this statement.",
  })
  @IsOptional()
  @IsUUID()
  creditCardId?: string;
}
