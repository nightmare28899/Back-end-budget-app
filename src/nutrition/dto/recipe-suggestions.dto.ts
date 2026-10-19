import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class RecipeSuggestionsDto {
  @ApiProperty({ description: "Diet meal option to cook for" })
  @IsUUID()
  optionId!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 3, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  count?: number;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  preferences?: string;
}
