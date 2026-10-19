import { ApiError, type GenerateContentResponse } from "@google/genai";
import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";

/** Finish reasons that mean Gemini refused to answer. */
export const BLOCKED_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "IMAGE_RECITATION",
]);

export function isBlockedResponse(response: GenerateContentResponse): boolean {
  if (response.promptFeedback?.blockReason) return true;
  const finishReason = response.candidates?.[0]?.finishReason as
    | string
    | undefined;
  return !!finishReason && BLOCKED_FINISH_REASONS.has(finishReason);
}

/** Maps a Gemini SDK failure to a generic HTTP exception (no provider details). */
export function mapGeminiError(
  error: unknown,
  logger: Logger,
  notConfiguredMessage: string,
): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof ApiError) {
    const invalidKey =
      error.status === 400 && /api[_ ]key/i.test(error.message);
    if (error.status === 401 || error.status === 403 || invalidKey) {
      logger.error("Gemini authentication failed; check GEMINI_API_KEY.");
      return new ServiceUnavailableException(notConfiguredMessage);
    }
    if (error.status === 429) {
      return new HttpException(
        "The AI service is busy. Try again in a minute.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    logger.error(`Gemini API error ${error.status}`);
  } else {
    logger.error("Unexpected Gemini failure");
  }
  return new BadGatewayException(
    "The AI service failed. Try again in a moment.",
  );
}

/** HTTP statuses Gemini returns when the model is temporarily overloaded. */
const TRANSIENT_GEMINI_STATUSES = new Set([500, 502, 503, 504]);

type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  wait?: (ms: number) => Promise<void>;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retries transient Gemini failures (overload, 5xx) with exponential backoff. */
export async function withGeminiRetry<T>(
  call: () => Promise<T>,
  {
    retries = 2,
    baseDelayMs = Number(process.env.GEMINI_RETRY_BASE_DELAY_MS ?? 1500),
    wait = sleep,
  }: RetryOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const transient =
        error instanceof ApiError &&
        TRANSIENT_GEMINI_STATUSES.has(error.status);
      if (!transient || attempt >= retries) throw error;
      await wait(baseDelayMs * 2 ** attempt);
    }
  }
}

const isTransientGeminiError = (error: unknown) =>
  error instanceof ApiError && TRANSIENT_GEMINI_STATUSES.has(error.status);

/**
 * Runs `call` on each model in order, retrying transient failures per model.
 * Moves to the next model only when the current one stays overloaded.
 */
export async function withGeminiModelFallback<T>(
  models: string[],
  call: (model: string) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;
  for (const model of models) {
    try {
      return await withGeminiRetry(() => call(model), options);
    } catch (error) {
      if (!isTransientGeminiError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
