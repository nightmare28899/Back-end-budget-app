import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { z } from "zod";
import {
  isBlockedResponse,
  mapGeminiError,
  withGeminiModelFallback,
} from "../diet-import/gemini.helpers";
import {
  DIET_IMPORT_CLIENT,
  DIET_IMPORT_TIMEOUT_MS,
  resolveDietImportModels,
} from "../diet-import/diet-import.service";
import { NutritionService } from "../nutrition.service";
import {
  hasUnquantifiedPortions,
  normalizeSuggestions,
} from "./recipe-suggestions.normalize";
import {
  RECIPE_SUGGESTIONS_SYSTEM_PROMPT,
  buildRecipeSuggestionsPrompt,
} from "./recipe-suggestions.prompt";
import {
  recipeSuggestionsSchema,
  type OptionContext,
  type OptionPortion,
  type RecipeSuggestionsExtraction,
  type RecipeSuggestionsResult,
} from "./recipe-suggestions.schema";

export const RECIPE_SUGGESTIONS_MAX_OUTPUT_TOKENS = 8000;
export const DEFAULT_SUGGESTION_COUNT = 3;

export const recipeSuggestionsJsonSchema = (() => {
  const schema = z.toJSONSchema(recipeSuggestionsSchema) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return schema;
})();

interface StateOption {
  id: string;
  title?: string | null;
  notes?: string | null;
  portions?: OptionPortion[];
}
interface StateShape {
  diets?: Array<{
    meals?: Array<{ type: string; options?: StateOption[] }>;
  }>;
}

export interface SuggestRecipesInput {
  optionId: string;
  count?: number;
  preferences?: string;
}

@Injectable()
export class RecipeSuggestionsService {
  private readonly logger = new Logger(RecipeSuggestionsService.name);

  constructor(
    private readonly nutrition: NutritionService,
    @Inject(DIET_IMPORT_CLIENT) private readonly client: GoogleGenAI | null,
  ) {}

  /** Generates recipe drafts for one diet option. Persists nothing. */
  async suggest(
    userId: string,
    input: SuggestRecipesInput,
  ): Promise<RecipeSuggestionsResult> {
    const option = await this.loadOption(userId, input.optionId);
    if (!this.client) {
      throw new ServiceUnavailableException(
        "AI recipe generation is not configured.",
      );
    }
    const count = input.count ?? DEFAULT_SUGGESTION_COUNT;
    if (hasUnquantifiedPortions(option.portions)) {
      // Skip the model call; the normalizer produces the warning.
      return normalizeSuggestions({ suggestions: [] }, option, count);
    }
    const extraction = await this.generate(
      this.client,
      buildRecipeSuggestionsPrompt(option, count, input.preferences),
    );
    return normalizeSuggestions(extraction, option, count);
  }

  private async loadOption(
    userId: string,
    optionId: string,
  ): Promise<OptionContext> {
    const state = (await this.nutrition.getState(userId)) as StateShape | null;
    for (const diet of state?.diets ?? []) {
      for (const meal of diet.meals ?? []) {
        const option = meal.options?.find((o) => o.id === optionId);
        if (option) {
          return {
            mealType: meal.type,
            title: option.title ?? "",
            notes: option.notes ?? null,
            portions: option.portions ?? [],
          };
        }
      }
    }
    throw new NotFoundException("Diet option unavailable.");
  }

  private async generate(
    client: GoogleGenAI,
    prompt: string,
  ): Promise<RecipeSuggestionsExtraction> {
    let response: GenerateContentResponse;
    try {
      response = await withGeminiModelFallback(
        resolveDietImportModels(),
        (model) =>
          client.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
              systemInstruction: RECIPE_SUGGESTIONS_SYSTEM_PROMPT,
              responseMimeType: "application/json",
              responseJsonSchema: recipeSuggestionsJsonSchema,
              maxOutputTokens: RECIPE_SUGGESTIONS_MAX_OUTPUT_TOKENS,
              httpOptions: { timeout: DIET_IMPORT_TIMEOUT_MS },
            },
          }),
      );
    } catch (error) {
      throw this.mapError(error);
    }
    return this.parse(response);
  }

  private parse(
    response: GenerateContentResponse,
  ): RecipeSuggestionsExtraction {
    const failed = new UnprocessableEntityException(
      "The AI could not create dishes for this option. Try again.",
    );
    if (isBlockedResponse(response)) throw failed;
    if ((response.candidates?.[0]?.finishReason as string) === "MAX_TOKENS") {
      throw failed;
    }
    let json: unknown;
    try {
      const text = response.text;
      if (!text) throw failed;
      json = JSON.parse(text);
    } catch {
      throw failed;
    }
    const parsed = recipeSuggestionsSchema.safeParse(json);
    if (!parsed.success) throw failed;
    return parsed.data;
  }

  private mapError(error: unknown): HttpException {
    return mapGeminiError(
      error,
      this.logger,
      "AI recipe generation is not configured.",
    );
  }
}
