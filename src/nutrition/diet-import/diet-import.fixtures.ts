import type { DietExtraction } from "./diet-import.schema";

/** A realistic (shortened) model output for a Mexican nutritionist sheet. */
export const sheetExtraction = (): DietExtraction => ({
  title: "Plan de alimentación Mayo",
  meals: [
    {
      type: "breakfast",
      timeWindow: "8:00 - 9:00 am",
      options: [
        {
          title: "Opción 1",
          notes: null,
          portions: [
            {
              food: "Huevo",
              quantity: 2,
              unit: "piezas",
              preparation: "cocido",
              free: false,
            },
            {
              food: "Tortilla de maíz",
              quantity: 0.5,
              unit: "pieza",
              preparation: null,
              free: false,
            },
          ],
        },
        {
          title: null,
          notes: "Pesar en cocido",
          portions: [
            {
              food: "Claras de huevo",
              quantity: 3,
              unit: "claras",
              preparation: null,
              free: false,
            },
          ],
        },
      ],
    },
    {
      type: "lunch",
      timeWindow: null,
      options: [
        {
          title: "Opción 1",
          notes: null,
          portions: [
            {
              food: "Pechuga de pollo",
              quantity: 120,
              unit: "gr",
              preparation: null,
              free: false,
            },
            {
              food: "Agua de jamaica sin azúcar",
              quantity: null,
              unit: null,
              preparation: null,
              free: true,
            },
          ],
        },
      ],
    },
  ],
  indications: ["Beber 2 L de agua", "Magnesio 2 cápsulas por la noche"],
  warnings: ["Cena was illegible"],
});
