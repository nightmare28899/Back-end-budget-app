import { z } from "zod";

export const MEAL_TYPES = [
  "breakfast",
  "morning_snack",
  "lunch",
  "afternoon_snack",
  "dinner",
] as const;
export type MealType = (typeof MEAL_TYPES)[number];

/**
 * Structured-output schema the model fills in. It is intentionally loose
 * (no length/range constraints): limits are enforced afterwards by
 * `normalizeDietExtraction`, which clamps instead of failing the request.
 */
export const dietExtractionSchema = z.object({
  title: z.string().nullable(),
  meals: z.array(
    z.object({
      type: z.enum(MEAL_TYPES),
      timeWindow: z.string().nullable(),
      options: z.array(
        z.object({
          title: z.string().nullable(),
          notes: z.string().nullable(),
          portions: z.array(
            z.object({
              food: z.string(),
              quantity: z.number().nullable(),
              unit: z.string().nullable(),
              preparation: z.string().nullable(),
              free: z.boolean(),
            }),
          ),
        }),
      ),
    }),
  ),
  indications: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type DietExtraction = z.infer<typeof dietExtractionSchema>;

/** Exact shape the `save_diet` nutrition command (and the diet editor) uses. */
export interface DraftPortion {
  id: string;
  foodId: string;
  foodName: string;
  quantity: string | null;
  unit: string;
  preparation: string;
  free: boolean;
}
export interface DraftOption {
  id: string;
  title: string;
  portions: DraftPortion[];
  notes: string;
  recipeId: null;
}
export interface DraftMeal {
  id: string;
  type: MealType;
  options: DraftOption[];
}
export interface DietDraft {
  id: string;
  title: string;
  startDate: string;
  endDate: null;
  status: "draft";
  active: false;
  meals: DraftMeal[];
}
export interface DietImportResult {
  draft: DietDraft;
  warnings: string[];
  unmapped: string[];
}
