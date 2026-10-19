import { ApiError } from "@google/genai";
import { withGeminiModelFallback, withGeminiRetry } from "./gemini.helpers";

const apiError = (status: number) =>
  new ApiError({ message: `status ${status}`, status });

describe("withGeminiRetry", () => {
  const noWait = () => Promise.resolve();

  it("retries transient Gemini failures and returns the first success", async () => {
    const call = jest
      .fn()
      .mockRejectedValueOnce(apiError(503))
      .mockRejectedValueOnce(apiError(500))
      .mockResolvedValue("ok");

    await expect(withGeminiRetry(call, { wait: noWait })).resolves.toBe("ok");
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("gives up after the configured retries and rethrows the last error", async () => {
    const call = jest.fn().mockRejectedValue(apiError(503));

    await expect(
      withGeminiRetry(call, { retries: 2, wait: noWait }),
    ).rejects.toMatchObject({ status: 503 });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-transient failures", async () => {
    const call = jest.fn().mockRejectedValue(apiError(400));

    await expect(withGeminiRetry(call, { wait: noWait })).rejects.toMatchObject(
      { status: 400 },
    );
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("waits with exponential backoff between attempts", async () => {
    const wait = jest.fn().mockResolvedValue(undefined);
    const call = jest
      .fn()
      .mockRejectedValueOnce(apiError(503))
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValue("ok");

    await withGeminiRetry(call, { baseDelayMs: 100, wait });
    expect(wait.mock.calls).toEqual([[100], [200]]);
  });
});

describe("withGeminiModelFallback", () => {
  const noWait = () => Promise.resolve();

  it("falls back to the next model when the primary stays overloaded", async () => {
    const call = jest.fn((model: string) =>
      model === "primary"
        ? Promise.reject(apiError(503))
        : Promise.resolve(model),
    );

    await expect(
      withGeminiModelFallback(["primary", "lite"], call, {
        retries: 1,
        wait: noWait,
      }),
    ).resolves.toBe("lite");
    expect(call.mock.calls.map(([model]) => model)).toEqual([
      "primary",
      "primary",
      "lite",
    ]);
  });

  it("does not fall back on non-transient errors", async () => {
    const call = jest.fn().mockRejectedValue(apiError(400));

    await expect(
      withGeminiModelFallback(["primary", "lite"], call, { wait: noWait }),
    ).rejects.toMatchObject({ status: 400 });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("rethrows the last transient error when every model is overloaded", async () => {
    const call = jest.fn().mockRejectedValue(apiError(503));

    await expect(
      withGeminiModelFallback(["primary", "lite"], call, {
        retries: 0,
        wait: noWait,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(call).toHaveBeenCalledTimes(2);
  });
});
