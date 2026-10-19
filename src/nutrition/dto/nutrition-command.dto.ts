import { ApiProperty } from "@nestjs/swagger";
import { IsDefined, IsIn, IsObject } from "class-validator";

export const NUTRITION_COMMANDS = [
  "save_diet",
  "verify_diet",
  "activate_diet",
  "save_recipe",
  "delete_recipe",
  "favorite",
  "cook_recipe",
  "undo_cook_recipe",
  "settings",
  "generate_plan",
  "completion",
  "choose_recipe",
] as const;

export type NutritionCommandName = (typeof NUTRITION_COMMANDS)[number];

export class NutritionCommandDto {
  @ApiProperty({ enum: NUTRITION_COMMANDS })
  @IsIn(NUTRITION_COMMANDS)
  command!: NutritionCommandName;

  @ApiProperty({
    type: "object",
    additionalProperties: true,
    description: "Command payload; validated in depth by the SQL function.",
  })
  @IsDefined()
  @IsObject()
  payload!: Record<string, unknown>;
}
