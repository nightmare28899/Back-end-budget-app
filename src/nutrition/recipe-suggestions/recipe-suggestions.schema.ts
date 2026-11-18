import { z } from "zod";

/**
 * Structured-output schema the model fills in. Loose on purpose: limits and
 * portion fidelity are enforced afterwards by `normalizeSuggestions`.
 */
export const recipeSuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      title: z.string(),
      duration: z.number().nullable(),
      steps: z.array(z.string()),
      notes: z.string().nullable(),
      freeIngredients: z.array(z.string()),
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
});
export type RecipeSuggestionsExtraction = z.infer<
  typeof recipeSuggestionsSchema
>;

/** Exact shape the `save_recipe` nutrition command accepts. */
export interface RecipeDraftIngredient {
  id: string;
  foodId: string;
  foodName: string;
  quantity: string | null;
  unit: string;
  preparation: string;
  free: boolean;
}
export interface RecipeDraft {
  id: string;
  title: string;
  type: string;
  duration: number;
  notes: string;
  imageUrl: null;
  demo: false;
  seedKey: null;
  ingredients: RecipeDraftIngredient[];
  steps: string[];
}
export interface RecipeSuggestionsResult {
  suggestions: RecipeDraft[];
  warnings: string[];
}

/** A prescribed portion as stored in the nutrition state. */
export interface OptionPortion {
  id: string;
  foodId: string;
  foodName: string;
  quantity: string | null;
  unit: string | null;
  preparation: string | null;
  free: boolean;
}
export interface OptionContext {
  mealType: string;
  title: string;
  notes: string | null;
  portions: OptionPortion[];
}
