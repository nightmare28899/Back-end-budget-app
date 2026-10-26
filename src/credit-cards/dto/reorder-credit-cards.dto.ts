import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
} from "class-validator";

export class ReorderCreditCardsDto {
  @ApiProperty({
    type: [String],
    description:
      "Credit card ids in the desired order. Unlisted cards keep their relative order after these.",
    example: ["card-id-1", "card-id-2"],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  ids!: string[];
}
