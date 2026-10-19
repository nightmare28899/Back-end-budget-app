import {
  GoogleGenAI,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { z } from "zod";
import {
  validateImportFiles,
  type ImportFile,
  type ImportUpload,
} from "./diet-import.files";
import {
  isBlockedResponse,
  mapGeminiError,
  withGeminiModelFallback,
} from "./gemini.helpers";
import { normalizeDietExtraction } from "./diet-import.normalize";
import {
  DIET_IMPORT_SYSTEM_PROMPT,
  DIET_IMPORT_USER_PROMPT,
} from "./diet-import.prompt";
import {
  dietExtractionSchema,
  type DietExtraction,
  type DietImportResult,
} from "./diet-import.schema";

export const DIET_IMPORT_DEFAULT_MODEL = "gemini-3.5-flash";
export const DIET_IMPORT_MAX_OUTPUT_TOKENS = 16000;
export const DIET_IMPORT_TIMEOUT_MS = 90_000;
/** DI token: a Gemini client, or null when GEMINI_API_KEY is not set. */
export const DIET_IMPORT_CLIENT = Symbol("DIET_IMPORT_CLIENT");

export function createDietImportClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  return apiKey
    ? new GoogleGenAI({
        apiKey,
        httpOptions: { timeout: DIET_IMPORT_TIMEOUT_MS },
      })
    : null;
}

export function resolveDietImportModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DIET_IMPORT_DEFAULT_MODEL;
}

/** Lighter model used when the primary one is overloaded. */
export const DIET_IMPORT_FALLBACK_MODEL = "gemini-3.5-flash-lite";

/** Primary model first, then the fallback (deduplicated). */
export function resolveDietImportModels(): string[] {
  const fallback =
    process.env.GEMINI_FALLBACK_MODEL?.trim() || DIET_IMPORT_FALLBACK_MODEL;
  return [...new Set([resolveDietImportModel(), fallback])];
}

/** JSON Schema sent to Gemini; the reply is still validated with zod. */
export const dietExtractionJsonSchema = (() => {
  const schema = z.toJSONSchema(dietExtractionSchema) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return schema;
})();

function toPart(file: ImportFile): Part {
  return {
    inlineData: { mimeType: file.mime, data: file.bytes.toString("base64") },
  };
}

@Injectable()
export class DietImportService {
  private readonly logger = new Logger(DietImportService.name);

  constructor(
    @Inject(DIET_IMPORT_CLIENT) private readonly client: GoogleGenAI | null,
  ) {}

  /** Extracts a DRAFT diet from the uploaded files. Persists nothing. */
  async importDiet(
    uploads: ImportUpload[] | undefined,
  ): Promise<DietImportResult> {
    const files = validateImportFiles(uploads);
    if (!this.client) {
      throw new ServiceUnavailableException(
        "AI diet extraction is not configured.",
      );
    }
    const extraction = await this.extract(this.client, files);
    return normalizeDietExtraction(
      extraction,
      new Date().toISOString().slice(0, 10),
    );
  }

  private async extract(
    client: GoogleGenAI,
    files: ImportFile[],
  ): Promise<DietExtraction> {
    let response: GenerateContentResponse;
    try {
      response = await withGeminiModelFallback(
        resolveDietImportModels(),
        (model) =>
          client.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [
                  ...files.map(toPart),
                  { text: DIET_IMPORT_USER_PROMPT },
                ],
              },
            ],
            config: {
              systemInstruction: DIET_IMPORT_SYSTEM_PROMPT,
              responseMimeType: "application/json",
              responseJsonSchema: dietExtractionJsonSchema,
              maxOutputTokens: DIET_IMPORT_MAX_OUTPUT_TOKENS,
              httpOptions: { timeout: DIET_IMPORT_TIMEOUT_MS },
            },
          }),
      );
    } catch (error) {
      throw this.mapError(error);
    }
    return this.parseResponse(response);
  }

  private parseResponse(response: GenerateContentResponse): DietExtraction {
    const refused = new UnprocessableEntityException(
      "The AI could not process this document. Try a clearer photo or enter the diet manually.",
    );
    if (isBlockedResponse(response)) throw refused;

    const finishReason = response.candidates?.[0]?.finishReason as
      | string
      | undefined;
    if (finishReason === "MAX_TOKENS") {
      throw new UnprocessableEntityException(
        "The document is too long to import. Try fewer pages or enter the diet manually.",
      );
    }

    const unreadable = new UnprocessableEntityException(
      "Could not read a diet from this document. Try a clearer photo or enter the diet manually.",
    );
    let json: unknown;
    try {
      const text = response.text;
      if (!text) throw unreadable;
      json = JSON.parse(text);
    } catch {
      throw unreadable;
    }
    const parsed = dietExtractionSchema.safeParse(json);
    if (!parsed.success) throw unreadable;
    return parsed.data;
  }

  private mapError(error: unknown): HttpException {
    return mapGeminiError(
      error,
      this.logger,
      "AI diet extraction is not configured.",
    );
  }
}
