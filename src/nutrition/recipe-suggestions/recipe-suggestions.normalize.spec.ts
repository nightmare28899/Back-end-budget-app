import { normalizeSuggestions } from "./recipe-suggestions.normalize";
import type {
  OptionContext,
  RecipeSuggestionsExtraction,
} from "./recipe-suggestions.schema";

const option: OptionContext = {
  mealType: "lunch",
  title: "Opción 1",
  notes: "Carne pesada en cocido",
  portions: [
    {
      id: "a",
      foodId: "pollo",
      foodName: "Pechuga de pollo",
      quantity: "120",
      unit: "gr",
      preparation: "cocida",
      free: false,
    },
    {
      id: "b",
      foodId: "tortilla",
      foodName: "Tortilla de maíz",
      quantity: "2",
      unit: "pieza",
      preparation: null,
      free: false,
    },
    {
      id: "c",
      foodId: "lechuga",
      foodName: "Lechuga",
      quantity: null,
      unit: null,
      preparation: null,
      free: true,
    },
  ],
};

const portions = () => [
  {
    food: "Pechuga de pollo",
    quantity: 120,
    unit: "gr",
    preparation: "cocida",
    free: false,
  },
  {
    food: "tortilla de maiz",
    quantity: 2,
    unit: "Pieza",
    preparation: null,
    free: false,
  },
  {
    food: "Lechuga",
    quantity: null,
    unit: null,
    preparation: null,
    free: true,
  },
];
const suggestion = (over: Record<string, unknown> = {}) => ({
  title: "  Tacos de pollo  ",
  duration: 25,
  steps: ["Desmenuza el pollo.", "Arma los tacos."],
  notes: "Sirve caliente.",
  freeIngredients: ["limón", "sal"],
  portions: portions(),
  ...over,
});
const run = (items: unknown[], count = 3) =>
  normalizeSuggestions(
    { suggestions: items } as RecipeSuggestionsExtraction,
    option,
    count,
  );

describe("normalizeSuggestions", () => {
  it("builds a save_recipe draft that copies the option's portions exactly", () => {
    const { suggestions, warnings } = run([suggestion()], 1);
    expect(warnings).toEqual([]);
    const [draft] = suggestions;
    expect(draft).toMatchObject({
      title: "Tacos de pollo",
      type: "lunch",
      duration: 25,
      imageUrl: null,
      demo: false,
      seedKey: null,
    });
    expect(draft.ingredients.map((i) => ({ ...i, id: "" }))).toEqual(
      option.portions.map((p) => ({
        ...p,
        id: "",
        unit: p.unit ?? "",
        preparation: p.preparation ?? "",
      })),
    );
    expect(new Set(draft.ingredients.map((i) => i.id)).size).toBe(3);
    expect(draft.ingredients.map((i) => i.id)).not.toContain("a");
    expect(draft.notes).toContain("Sirve caliente.");
    expect(draft.notes).toContain("limón, sal");
  });

  it("drops suggestions that change a quantity, unit or food, with a warning", () => {
    const changedQty = suggestion({
      portions: portions().map((p) =>
        p.food === "Pechuga de pollo" ? { ...p, quantity: 200 } : p,
      ),
    });
    const extra = suggestion({
      portions: [
        ...portions(),
        {
          food: "Aceite",
          quantity: 1,
          unit: "cda",
          preparation: null,
          free: false,
        },
      ],
    });
    const missing = suggestion({ portions: portions().slice(0, 2) });
    const { suggestions, warnings } = run([
      changedQty,
      extra,
      missing,
      suggestion({ title: "Bien" }),
    ]);
    expect(suggestions.map((s) => s.title)).toEqual(["Bien"]);
    expect(warnings.some((w) => /^3 suggestion\(s\).*portions/.test(w))).toBe(
      true,
    );
  });

  it("drops empty-title or step-less suggestions and clamps limits", () => {
    const { suggestions } = run([
      suggestion({ title: "  " }),
      suggestion({ steps: [] }),
      suggestion({
        title: "x".repeat(300),
        duration: 99999,
        steps: Array.from({ length: 15 }, (_, i) => `Paso ${i + 1}`),
      }),
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toHaveLength(120);
    expect(suggestions[0].duration).toBe(1440);
    expect(suggestions[0].steps).toHaveLength(10);
  });

  it("defaults a missing duration, removes duplicate titles and caps at count", () => {
    const { suggestions, warnings } = run(
      [
        suggestion({ duration: null }),
        suggestion(),
        suggestion({ title: "Otro" }),
        suggestion({ title: "Más" }),
      ],
      2,
    );
    expect(suggestions.map((s) => s.title)).toEqual(["Tacos de pollo", "Otro"]);
    expect(suggestions[0].duration).toBe(20);
    expect(warnings).toEqual([]);
  });

  it("warns when fewer valid suggestions than requested remain", () => {
    const { warnings } = run([suggestion()], 3);
    expect(warnings.some((w) => /1 of 3/.test(w))).toBe(true);
  });

  it("refuses options with unquantified prescribed portions", () => {
    const unknown: OptionContext = {
      ...option,
      portions: [{ ...option.portions[0], quantity: null }],
    };
    const result = normalizeSuggestions(
      { suggestions: [suggestion()] } as RecipeSuggestionsExtraction,
      unknown,
      3,
    );
    expect(result.suggestions).toEqual([]);
    expect(result.warnings[0]).toMatch(/verify/i);
  });
});
