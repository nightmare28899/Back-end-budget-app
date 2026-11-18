import { sheetExtraction } from "./diet-import.fixtures";
import {
  normalizeDietExtraction,
  slugifyFood,
  toExactQuantity,
} from "./diet-import.normalize";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const normalize = (extraction = sheetExtraction()) =>
  normalizeDietExtraction(extraction, "2026-10-06");

describe("toExactQuantity", () => {
  it.each([
    [2, "2"],
    [0.5, "0.5"],
    [120, "120"],
    [0.333333333333333, "0.333333333333"],
    [1.25, "1.25"],
  ])("formats %s as %s", (input, expected) => {
    expect(toExactQuantity(input)).toBe(expected);
  });

  it.each([null, 0, -1, Number.NaN, Infinity, 1e13])("rejects %s", (input) => {
    expect(toExactQuantity(input)).toBeNull();
  });
});

describe("slugifyFood", () => {
  it("strips accents and punctuation", () => {
    expect(slugifyFood("Tortilla de maíz (2 pzas)")).toBe(
      "tortilla-de-maiz-2-pzas",
    );
  });
  it("falls back for empty and clamps to 100 chars", () => {
    expect(slugifyFood("¿?")).toBe("food");
    expect(slugifyFood("a".repeat(300))).toHaveLength(100);
  });
});

describe("normalizeDietExtraction", () => {
  it("maps the fixture to a draft in the save_diet shape", () => {
    const { draft } = normalize();

    expect(draft.id).toMatch(UUID);
    expect(draft).toMatchObject({
      title: "Plan de alimentación Mayo",
      startDate: "2026-10-06",
      endDate: null,
      status: "draft",
      active: false,
    });
    expect(draft.meals.map((meal) => meal.type)).toEqual([
      "breakfast",
      "morning_snack",
      "lunch",
      "afternoon_snack",
      "dinner",
    ]);

    const breakfast = draft.meals[0];
    expect(breakfast.options).toHaveLength(2);
    expect(breakfast.options[1].title).toBe("Opción 2");
    expect(breakfast.options[1].notes).toBe("Pesar en cocido");
    expect(breakfast.options[0].recipeId).toBeNull();
    expect(breakfast.options[0].portions[1]).toMatchObject({
      foodId: "tortilla-de-maiz",
      foodName: "Tortilla de maíz",
      quantity: "0.5",
      unit: "pieza",
      preparation: "",
      free: false,
    });
    expect(breakfast.options[0].portions[0].preparation).toBe("cocido");

    const free = draft.meals[2].options[0].portions[1];
    expect(free).toMatchObject({ free: true, quantity: null, unit: "" });
  });

  it("generates unique uuids for every meal, option and portion", () => {
    const { draft } = normalize();
    const ids = draft.meals.flatMap((meal) => [
      meal.id,
      ...meal.options.flatMap((option) => [
        option.id,
        ...option.portions.map((portion) => portion.id),
      ]),
    ]);
    expect(ids.every((id) => UUID.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("moves indications and time windows to unmapped, keeps model warnings", () => {
    const { unmapped, warnings } = normalize();
    expect(unmapped).toEqual(
      expect.arrayContaining([
        "Beber 2 L de agua",
        "Magnesio 2 cápsulas por la noche",
        "breakfast: 8:00 - 9:00 am",
      ]),
    );
    expect(warnings).toContain("Cena was illegible");
  });

  it("warns about meals missing from the sheet", () => {
    const { warnings, draft } = normalize();
    expect(draft.meals[4].options).toEqual([]);
    expect(warnings.some((warning) => warning.includes("dinner"))).toBe(true);
  });

  it("merges duplicated meal types instead of emitting them twice", () => {
    const extraction = sheetExtraction();
    extraction.meals.push({ ...extraction.meals[0] });
    const { draft } = normalize(extraction);
    expect(draft.meals).toHaveLength(5);
    expect(new Set(draft.meals.map((meal) => meal.type)).size).toBe(5);
    expect(draft.meals[0].options).toHaveLength(4);
  });

  it("nulls a quantity that has no unit and warns", () => {
    const extraction = sheetExtraction();
    extraction.meals[0].options[0].portions[0].unit = "  ";
    const { draft, warnings } = normalize(extraction);
    expect(draft.meals[0].options[0].portions[0].quantity).toBeNull();
    expect(warnings.some((warning) => warning.includes("Huevo"))).toBe(true);
  });

  it("clamps text to the save_diet limits", () => {
    const extraction = sheetExtraction();
    extraction.title = "T".repeat(500);
    const option = extraction.meals[0].options[0];
    option.title = "O".repeat(500);
    option.notes = "N".repeat(5000);
    option.portions[0].food = "F".repeat(500);
    option.portions[0].unit = "U".repeat(100);
    option.portions[0].preparation = "P".repeat(900);
    const { draft } = normalize(extraction);
    const normalized = draft.meals[0].options[0];
    expect(draft.title).toHaveLength(120);
    expect(normalized.title).toHaveLength(120);
    expect(normalized.notes).toHaveLength(2000);
    expect(normalized.portions[0].foodName).toHaveLength(120);
    expect(normalized.portions[0].foodId.length).toBeLessThanOrEqual(100);
    expect(normalized.portions[0].unit).toHaveLength(40);
    expect(normalized.portions[0].preparation).toHaveLength(300);
  });

  it("caps options at 12 and portions at 30, reporting the overflow", () => {
    const extraction = sheetExtraction();
    const base = extraction.meals[0].options[0];
    extraction.meals[0].options = Array.from({ length: 14 }, (_, index) => ({
      ...base,
      title: `Opción ${index + 1}`,
      portions: Array.from({ length: 32 }, (_, n) => ({
        ...base.portions[0],
        food: `Alimento ${n}`,
      })),
    }));
    const { draft, unmapped } = normalize(extraction);
    expect(draft.meals[0].options).toHaveLength(12);
    expect(draft.meals[0].options[0].portions).toHaveLength(30);
    expect(unmapped.some((entry) => entry.includes("Opción 13"))).toBe(true);
  });

  it("drops options and portions without a food name", () => {
    const extraction = sheetExtraction();
    extraction.meals[0].options[0].portions[0].food = "   ";
    extraction.meals[1].options[0].portions = [];
    const { draft, warnings } = normalize(extraction);
    expect(draft.meals[0].options[0].portions).toHaveLength(1);
    expect(draft.meals[2].options).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("uses a default title when the sheet has none", () => {
    const extraction = sheetExtraction();
    extraction.title = null;
    expect(normalize(extraction).draft.title).toBe("Dieta importada");
  });
});
