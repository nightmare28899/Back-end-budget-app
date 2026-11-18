import { randomUUID } from "node:crypto";
import type {
  OptionContext,
  OptionPortion,
  RecipeDraft,
  RecipeSuggestionsExtraction,
  RecipeSuggestionsResult,
} from "./recipe-suggestions.schema";

export const MAX_TITLE = 120;
export const MAX_STEPS = 10;
export const MAX_STEP_LENGTH = 2000;
export const MAX_NOTES = 3000;
export const DEFAULT_DURATION = 20;
export const MAX_DURATION = 1440;

const fold = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** True when any non-free prescribed portion has no exact quantity. */
export function hasUnquantifiedPortions(portions: OptionPortion[]): boolean {
  return portions.some((p) => !p.free && (p.quantity === null || !p.unit));
}

type PortionLike = {
  food: string;
  quantity: number | string | null;
  unit: string | null;
  free: boolean;
};

/** Canonical key: name, exact quantity (none for free foods), unit and free flag. */
function portionKey(p: PortionLike): string {
  const quantity =
    p.free || p.quantity === null ? "" : String(Number(p.quantity));
  return JSON.stringify([
    fold(p.food),
    quantity,
    p.free ? "" : fold(p.unit),
    p.free,
  ]);
}

/**
 * The model must echo the option's portions untouched. Compared as a
 * multiset so ordering and name casing/accents do not matter.
 */
export function portionsMatchOption(
  echoed: PortionLike[],
  prescribed: OptionPortion[],
): boolean {
  if (echoed.length !== prescribed.length) return false;
  const expected = prescribed
    .map((p) => portionKey({ ...p, food: p.foodName }))
    .sort();
  const actual = echoed.map(portionKey).sort();
  return expected.every((key, i) => key === actual[i]);
}

function clampDuration(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_DURATION;
  }
  return Math.min(Math.round(value), MAX_DURATION);
}

function buildNotes(notes: string | null, free: string[]): string {
  const parts: string[] = [];
  if (notes?.trim()) parts.push(notes.trim());
  const cleaned = free.map((f) => f.trim()).filter(Boolean);
  if (cleaned.length) parts.push(`Ingredientes libres: ${cleaned.join(", ")}.`);
  return parts.join("\n").slice(0, MAX_NOTES);
}

/**
 * Turns raw model output into `save_recipe` drafts. Ingredients are always
 * copied from the option (fresh ids), never from the model; suggestions whose
 * echoed portions differ from the prescription are dropped.
 */
export function normalizeSuggestions(
  extraction: RecipeSuggestionsExtraction,
  option: OptionContext,
  count: number,
): RecipeSuggestionsResult {
  const warnings: string[] = [];
  if (hasUnquantifiedPortions(option.portions)) {
    return {
      suggestions: [],
      warnings: [
        "Verify the exact portions of this option before generating dishes.",
      ],
    };
  }

  const suggestions: RecipeDraft[] = [];
  const titles = new Set<string>();
  let altered = 0;

  for (const raw of extraction.suggestions) {
    if (suggestions.length >= count) break;
    if (!portionsMatchOption(raw.portions, option.portions)) {
      altered += 1;
      continue;
    }
    const title = raw.title.trim().slice(0, MAX_TITLE).trim();
    const steps = raw.steps
      .map((s) => s.trim().slice(0, MAX_STEP_LENGTH))
      .filter(Boolean)
      .slice(0, MAX_STEPS);
    if (!title || steps.length === 0 || titles.has(fold(title))) continue;
    titles.add(fold(title));

    suggestions.push({
      id: randomUUID(),
      title,
      type: option.mealType,
      duration: clampDuration(raw.duration),
      notes: buildNotes(raw.notes, raw.freeIngredients),
      imageUrl: null,
      demo: false,
      seedKey: null,
      ingredients: option.portions.map((p) => ({
        id: randomUUID(),
        foodId: p.foodId,
        foodName: p.foodName,
        quantity: p.free ? null : p.quantity,
        unit: p.unit ?? "",
        preparation: p.preparation ?? "",
        free: p.free,
      })),
      steps,
    });
  }

  if (altered > 0) {
    warnings.push(
      `${altered} suggestion(s) were discarded because they changed the prescribed portions.`,
    );
  }
  if (suggestions.length < count) {
    warnings.push(
      `Only ${suggestions.length} of ${count} requested dishes were usable.`,
    );
  }
  return { suggestions, warnings };
}
