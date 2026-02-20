import { describe, expect, it, mock } from "bun:test";
import { withRetry } from "./retry";

describe("withRetry", () => {
  it("retries up to 3 times on retryable errors", async () => {
    const operation = mock(async () => {
      throw new Error("temporary network issue");
    });

    const result = await withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 1,
      shouldRetry: () => true,
    });

    expect(operation).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
  });

  it("succeeds on 3rd attempt after 2 failures", async () => {
    let attempts = 0;
    const operation = mock(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("flaky network");
      }
      return "ok";
    });

    const result = await withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 1,
      shouldRetry: () => true,
    });

    expect(operation).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
    expect(result.value).toBe("ok");
    expect(result.attempts).toBe(3);
  });

  it("uses exponential backoff delays of 1s, 2s, 4s", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const delays: number[] = [];

    const setTimeoutMock = mock((handler: unknown, delay?: number) => {
      delays.push(typeof delay === "number" ? delay : 0);
      if (typeof handler === "function") {
        handler();
      }
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    globalThis.setTimeout = setTimeoutMock as unknown as typeof setTimeout;

    try {
      const operation = mock(async () => {
        throw new Error("network timeout");
      });

      const result = await withRetry(operation, {
        maxAttempts: 4,
        baseDelayMs: 1000,
        shouldRetry: () => true,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(4);
      expect(delays).toEqual([1000, 2000, 4000]);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  it("does not retry when shouldRetry returns false", async () => {
    const operation = mock(async () => {
      throw new Error("validation failure");
    });

    const result = await withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 1,
      shouldRetry: () => false,
    });

    expect(operation).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
  });

  it("returns last error after max attempts exhausted", async () => {
    const errors = [new Error("first"), new Error("second"), new Error("third")];
    let index = 0;
    const operation = mock(async () => {
      const error = errors[index] ?? errors[2];
      index += 1;
      throw error;
    });

    const result = await withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 1,
      shouldRetry: () => true,
    });

    expect(operation).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(false);
    expect(result.error).toBe(errors[2]);
    expect(result.attempts).toBe(3);
  });

  it("tracks attempt count in successful result", async () => {
    const operation = mock(async () => "done");

    const result = await withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 1,
      shouldRetry: () => true,
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe("done");
    expect(result.attempts).toBe(1);
  });
});
