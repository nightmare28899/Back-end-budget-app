import { ApiError, type GoogleGenAI } from "@google/genai";
import {
  BadGatewayException,
  HttpException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { sheetExtraction } from "./diet-import.fixtures";
import {
  DIET_IMPORT_DEFAULT_MODEL,
  DietImportService,
} from "./diet-import.service";

const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9,
]);
const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

function build(generate: jest.Mock | null) {
  const client = generate ? { models: { generateContent: generate } } : null;
  return new DietImportService(client as unknown as GoogleGenAI | null);
}
const ok = (overrides: Record<string, unknown> = {}) => ({
  text: JSON.stringify(sheetExtraction()),
  candidates: [{ finishReason: "STOP" }],
  ...overrides,
});
interface SentParams {
  model: string;
  contents: {
    role: string;
    parts: { text?: string; inlineData?: { mimeType: string; data: string } }[];
  }[];
  config: {
    systemInstruction: string;
    responseMimeType: string;
    responseJsonSchema: Record<string, unknown>;
    maxOutputTokens: number;
    httpOptions: { timeout: number };
  };
}
const sentParams = (generate: jest.Mock) =>
  (generate.mock.calls as [SentParams][])[0][0];
const upload = [{ originalname: "p1.jpg", buffer: jpeg }];
const rejects = (generate: jest.Mock) => build(generate).importDiet(upload);

// Skip real backoff waits for transient Gemini errors.
process.env.GEMINI_RETRY_BASE_DELAY_MS = "0";
describe("DietImportService", () => {
  const savedModel = process.env.GEMINI_MODEL;
  beforeEach(() => {
    delete process.env.GEMINI_MODEL;
  });
  afterAll(() => {
    if (savedModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = savedModel;
  });

  it("returns a normalized draft without touching storage", async () => {
    const generate = jest.fn().mockResolvedValue(ok());
    const result = await build(generate).importDiet(upload);

    expect(result.draft.meals).toHaveLength(5);
    expect(result.draft.title).toBe("Plan de alimentación Mayo");
    expect(result.unmapped).toContain("Beber 2 L de agua");
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("sends files before the instruction with JSON schema output", async () => {
    const generate = jest.fn().mockResolvedValue(ok());
    await build(generate).importDiet([
      { originalname: "a.jpg", buffer: jpeg },
      { originalname: "b.jpg", buffer: jpeg },
    ]);

    const params = sentParams(generate);
    expect(params.model).toBe(DIET_IMPORT_DEFAULT_MODEL);
    expect(params.config.responseMimeType).toBe("application/json");
    expect(params.config.responseJsonSchema).toBeDefined();
    expect(params.config.responseJsonSchema.$schema).toBeUndefined();
    expect(params.config.maxOutputTokens).toBe(16000);
    expect(params.config.httpOptions.timeout).toBe(90_000);
    expect(typeof params.config.systemInstruction).toBe("string");
    const parts = params.contents[0].parts;
    expect(parts.map((part) => (part.inlineData ? "file" : "text"))).toEqual([
      "file",
      "file",
      "text",
    ]);
    expect(parts[0].inlineData).toEqual({
      mimeType: "image/jpeg",
      data: jpeg.toString("base64"),
    });
  });

  it("honors GEMINI_MODEL", async () => {
    process.env.GEMINI_MODEL = "gemini-custom";
    const generate = jest.fn().mockResolvedValue(ok());
    await build(generate).importDiet(upload);
    expect(sentParams(generate).model).toBe("gemini-custom");
  });

  it("sends a pdf as an application/pdf inline part", async () => {
    const generate = jest.fn().mockResolvedValue(ok());
    await build(generate).importDiet([{ originalname: "d.pdf", buffer: pdf }]);
    expect(sentParams(generate).contents[0].parts[0].inlineData?.mimeType).toBe(
      "application/pdf",
    );
  });

  it("validates files before calling the model", async () => {
    const generate = jest.fn();
    await expect(build(generate).importDiet([])).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it("returns 503 when no client is configured", async () => {
    await expect(build(null).importDiet(upload)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it.each(["SAFETY", "PROHIBITED_CONTENT", "RECITATION"])(
    "maps finish reason %s to 422",
    async (finishReason) => {
      const generate = jest
        .fn()
        .mockResolvedValue(ok({ candidates: [{ finishReason }] }));
      await expect(rejects(generate)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    },
  );

  it("maps a blocked prompt to 422", async () => {
    const generate = jest.fn().mockResolvedValue({
      promptFeedback: { blockReason: "SAFETY" },
      candidates: undefined,
      text: undefined,
    });
    await expect(rejects(generate)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it("maps MAX_TOKENS to 422 document too long", async () => {
    const generate = jest.fn().mockResolvedValue(
      ok({
        candidates: [{ finishReason: "MAX_TOKENS" }],
        text: '{"title":',
      }),
    );
    await expect(rejects(generate)).rejects.toThrow(/too long/i);
  });

  it.each([
    ["empty text", { text: "" }],
    ["undefined text", { text: undefined }],
    ["invalid JSON", { text: "not json" }],
    ["schema mismatch", { text: JSON.stringify({ foo: 1 }) }],
  ])("treats %s as an extraction failure (422)", async (_name, override) => {
    const generate = jest.fn().mockResolvedValue(ok(override));
    await expect(rejects(generate)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it("maps API errors: auth/invalid key 503, quota 429, other 502", async () => {
    const api = (status: number, message = "x") =>
      jest.fn().mockRejectedValue(new ApiError({ message, status }));

    await expect(rejects(api(401))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(rejects(api(403))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(
      rejects(api(400, "API key not valid. Please pass a valid API key.")),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(rejects(api(429))).rejects.toMatchObject({ status: 429 });
    await expect(rejects(api(500))).rejects.toBeInstanceOf(BadGatewayException);
    await expect(rejects(api(400, "bad request"))).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it("does not leak unknown errors", async () => {
    const generate = jest.fn().mockRejectedValue(new Error("secret internals"));
    const error = await rejects(generate).catch((e: HttpException) => e);
    expect(error).toMatchObject({ status: 502 });
    expect(JSON.stringify((error as HttpException).getResponse())).not.toMatch(
      /secret/,
    );
  });
});
