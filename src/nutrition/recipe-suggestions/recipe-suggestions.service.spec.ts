import { ApiError, type GoogleGenAI } from "@google/genai";
import {
  BadGatewayException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { RecipeSuggestionsService } from "./recipe-suggestions.service";

const OPTION = "22222222-2222-4222-8222-222222222222";
const state = {
  diets: [
    {
      id: "d1",
      meals: [
        {
          id: "m1",
          type: "lunch",
          options: [
            {
              id: OPTION,
              title: "Opción 1",
              notes: "Carne pesada en cocido",
              portions: [
                {
                  id: "p1",
                  foodId: "pollo",
                  foodName: "Pechuga de pollo",
                  quantity: "120",
                  unit: "gr",
                  preparation: "cocida",
                  free: false,
                },
                {
                  id: "p2",
                  foodId: "tortilla",
                  foodName: "Tortilla",
                  quantity: "2",
                  unit: "pieza",
                  preparation: null,
                  free: false,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
const model = (over: Record<string, unknown> = {}) => ({
  suggestions: [
    {
      title: "Tacos de pollo",
      duration: 20,
      steps: ["Calienta.", "Sirve."],
      notes: null,
      freeIngredients: ["limón"],
      portions: [
        {
          food: "Pechuga de pollo",
          quantity: 120,
          unit: "gr",
          preparation: "cocida",
          free: false,
        },
        {
          food: "Tortilla",
          quantity: 2,
          unit: "pieza",
          preparation: null,
          free: false,
        },
      ],
      ...over,
    },
  ],
});
const ok = (body: unknown = model(), extra: Record<string, unknown> = {}) => ({
  text: JSON.stringify(body),
  candidates: [{ finishReason: "STOP" }],
  ...extra,
});

function build(generate: jest.Mock | null) {
  const nutrition = { getState: jest.fn().mockResolvedValue(state) };
  const client = generate ? { models: { generateContent: generate } } : null;
  const service = new RecipeSuggestionsService(
    nutrition as never,
    client as unknown as GoogleGenAI | null,
  );
  return { service, nutrition };
}
const call = (generate: jest.Mock, dto = {}) =>
  build(generate).service.suggest("user-1", { optionId: OPTION, ...dto });

// Skip real backoff waits for transient Gemini errors.
process.env.GEMINI_RETRY_BASE_DELAY_MS = "0";
describe("RecipeSuggestionsService", () => {
  it("returns validated drafts without persisting", async () => {
    const generate = jest.fn().mockResolvedValue(ok());
    const { service, nutrition } = build(generate);
    const result = await service.suggest("user-1", {
      optionId: OPTION,
      count: 1,
    });

    expect(nutrition.getState).toHaveBeenCalledWith("user-1");
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].type).toBe("lunch");
    expect(result.suggestions[0].ingredients.map((i) => i.quantity)).toEqual([
      "120",
      "2",
    ]);
  });

  it("sends the prescription, notes and preferences to Gemini with JSON schema", async () => {
    const generate = jest.fn().mockResolvedValue(ok());
    await call(generate, { count: 2, preferences: "sin picante" });
    const [params] = generate.mock.calls[0] as [
      {
        contents: { parts: { text: string }[] }[];
        config: Record<string, unknown>;
      },
    ];
    const text = params.contents[0].parts[0].text;
    expect(text).toContain("Pechuga de pollo");
    expect(text).toContain("120");
    expect(text).toContain("Carne pesada en cocido");
    expect(text).toContain("sin picante");
    expect(text).toContain("2");
    expect(params.config.responseMimeType).toBe("application/json");
    expect(params.config.responseJsonSchema).toBeDefined();
  });

  it("drops suggestions that alter portions and warns", async () => {
    const bad = model({
      portions: [
        {
          food: "Pechuga de pollo",
          quantity: 300,
          unit: "gr",
          preparation: "cocida",
          free: false,
        },
        {
          food: "Tortilla",
          quantity: 2,
          unit: "pieza",
          preparation: null,
          free: false,
        },
      ],
    });
    const result = await call(jest.fn().mockResolvedValue(ok(bad)));
    expect(result.suggestions).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/portions/i);
  });

  it("404s for an option the user does not own, before calling Gemini", async () => {
    const generate = jest.fn();
    await expect(
      build(generate).service.suggest("user-1", {
        optionId: "99999999-9999-4999-8999-999999999999",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(generate).not.toHaveBeenCalled();
  });

  it("returns a warning, without calling Gemini, for unquantified options", async () => {
    const generate = jest.fn();
    const { service, nutrition } = build(generate);
    nutrition.getState.mockResolvedValue({
      diets: [
        {
          meals: [
            {
              type: "lunch",
              options: [
                {
                  id: OPTION,
                  title: null,
                  notes: null,
                  portions: [
                    {
                      id: "x",
                      foodId: "a",
                      foodName: "A",
                      quantity: null,
                      unit: null,
                      preparation: null,
                      free: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const result = await service.suggest("user-1", { optionId: OPTION });
    expect(result.suggestions).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it("503s when Gemini is not configured", async () => {
    await expect(
      build(null).service.suggest("u", { optionId: OPTION }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([
    [401, ServiceUnavailableException],
    [429, HttpException],
    [500, BadGatewayException],
  ])("maps Gemini %s errors generically", async (status, type) => {
    const generate = jest
      .fn()
      .mockRejectedValue(new ApiError({ message: "secret detail", status }));
    const error = await call(generate).catch((e: HttpException) => e);
    expect(error).toBeInstanceOf(type);
    expect((error as HttpException).getStatus()).toBe(
      status === 401 ? 503 : status === 429 ? 429 : 502,
    );
    expect((error as HttpException).message).not.toContain("secret");
  });

  it("422s on blocked, truncated or invalid replies", async () => {
    for (const response of [
      ok(model(), { promptFeedback: { blockReason: "SAFETY" } }),
      ok(model(), { candidates: [{ finishReason: "SAFETY" }] }),
      ok(model(), { candidates: [{ finishReason: "MAX_TOKENS" }] }),
      { text: "not json", candidates: [{ finishReason: "STOP" }] },
      ok({ suggestions: "nope" }),
    ]) {
      await expect(
        call(jest.fn().mockResolvedValue(response)),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    }
  });
});
