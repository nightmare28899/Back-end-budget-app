import { ArrayMinSize, ArrayUnique, IsUUID } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class LinkExpensesDto {
  @ApiProperty({
    type: [String],
    example: ["8f4d2ea1-3d68-4b94-98ee-5a5abf71dc5c"],
  })
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID(4, { each: true })
  expenseIds: string[];
}
