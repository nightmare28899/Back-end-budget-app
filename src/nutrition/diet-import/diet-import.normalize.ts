import { randomUUID } from "node:crypto";
import {
  MEAL_TYPES,
  type DietDraft,
  type DietExtraction,
  type DietImportResult,
  type DraftMeal,
  type DraftOption,
  type DraftPortion,
} from "./diet-import.schema";

// Limits enforced by the `save_diet` SQL command.
const MAX_TITLE = 120;
const MAX_OPTIONS = 12;
const MAX_PORTIONS = 30;
const MAX_FOOD_ID = 100;
const MAX_FOOD_NAME = 120;
const MAX_UNIT = 40;
const MAX_PREPARATION = 300;
const MAX_NOTES = 2000;
const MAX_REPORT_ENTRY = 500;
const MAX_REPORT_ENTRIES = 60;
const DEFAULT_TITLE = "Dieta importada";

const clamp = (value: string | null | undefined, max: number): string =>
  (value ?? "").trim().slice(0, max).trim();

/** Positive decimal with at most 12 integer and 12 fraction digits, as text. */
export function toExactQuantity(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 1e12) return null;
  const text = value.toFixed(12).replace(/\.?0+$/, "");
  return text === "" || text === "0" ? null : text;
}

export function slugifyFood(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_FOOD_ID)
    .replace(/-+$/g, "");
  return slug || "food";
}

type Report = { warnings: string[]; unmapped: string[] };

function normalizePortions(
  portions: DietExtraction["meals"][number]["options"][number]["portions"],
  context: string,
  report: Report,
): DraftPortion[] {
  const result: DraftPortion[] = [];
  for (const portion of portions) {
    const foodName = clamp(portion.food, MAX_FOOD_NAME);
    if (!foodName) {
      report.warnings.push(
        `${context}: an item without a food name was dropped.`,
      );
      continue;
    }
    if (result.length >= MAX_PORTIONS) {
      report.unmapped.push(`${context}: extra item "${foodName}"`);
      continue;
    }
    const unit = clamp(portion.unit, MAX_UNIT);
    let quantity = portion.free ? null : toExactQuantity(portion.quantity);
    if (quantity !== null && !unit) {
      report.warnings.push(
        `${context}: "${foodName}" has a quantity but no unit; quantity left empty.`,
      );
      quantity = null;
    }
    result.push({
      id: randomUUID(),
      foodId: slugifyFood(foodName),
      foodName,
      quantity,
      unit: portion.free ? "" : unit,
      preparation: clamp(portion.preparation, MAX_PREPARATION),
      free: portion.free,
    });
  }
  return result;
}

function pushUnique(target: string[], values: string[]): void {
  for (const raw of values) {
    const value = clamp(raw, MAX_REPORT_ENTRY);
    if (value && !target.includes(value) && target.length < MAX_REPORT_ENTRIES)
      target.push(value);
  }
}

/**
 * Turns the model's loose extraction into a draft that satisfies every
 * `save_diet` rule: five unique meal types, <=12 options, 1..30 portions,
 * bounded text, exact decimal quantities, uuid ids. Anything that does not
 * fit is reported through `warnings` / `unmapped` instead of failing.
 */
export function normalizeDietExtraction(
  extraction: DietExtraction,
  today: string,
): DietImportResult {
  const report: Report = { warnings: [], unmapped: [] };
  pushUnique(report.warnings, extraction.warnings);
  pushUnique(report.unmapped, extraction.indications);

  const byType = new Map<string, DraftMeal>(
    MEAL_TYPES.map((type) => [type, { id: randomUUID(), type, options: [] }]),
  );
  const seen = new Set<string>();

  for (const meal of extraction.meals) {
    const target = byType.get(meal.type)!;
    seen.add(meal.type);
    if (meal.timeWindow?.trim())
      pushUnique(report.unmapped, [`${meal.type}: ${meal.timeWindow.trim()}`]);

    for (const option of meal.options) {
      const position = target.options.length + 1;
      const title = clamp(option.title, MAX_TITLE) || `Opción ${position}`;
      if (position > MAX_OPTIONS) {
        report.unmapped.push(`${meal.type}: extra option "${title}"`);
        continue;
      }
      const context = `${meal.type} / ${title}`;
      const portions = normalizePortions(option.portions, context, report);
      if (!portions.length) {
        report.warnings.push(
          `${context}: option without readable foods was dropped.`,
        );
        continue;
      }
      const notes = (option.notes ?? "").trim();
      if (notes.length > MAX_NOTES)
        report.warnings.push(
          `${context}: notes were shortened to ${MAX_NOTES} characters.`,
        );
      const normalized: DraftOption = {
        id: randomUUID(),
        title,
        portions,
        notes: notes.slice(0, MAX_NOTES),
        recipeId: null,
      };
      target.options.push(normalized);
    }
  }

  // Titles for unnamed options must follow final position; renumber defaults.
  for (const meal of byType.values()) {
    meal.options.forEach((option, index) => {
      if (/^Opción \d+$/.test(option.title))
        option.title = `Opción ${index + 1}`;
    });
  }

  for (const type of MEAL_TYPES)
    if (!seen.has(type) || !byType.get(type)!.options.length)
      report.warnings.push(`No options found for ${type}.`);

  const draft: DietDraft = {
    id: randomUUID(),
    title: clamp(extraction.title, MAX_TITLE) || DEFAULT_TITLE,
    startDate: today,
    endDate: null,
    status: "draft",
    active: false,
    meals: MEAL_TYPES.map((type) => byType.get(type)!),
  };
  return { draft, warnings: report.warnings, unmapped: report.unmapped };
}
