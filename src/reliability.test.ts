import { describe, it, expect } from "vitest";
import { withRetry } from "./reliability.js";

describe("withRetry", () => {
  it("returns on first success", async () => {
    const result = await withRetry(() => Promise.resolve("ok"), {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 100,
      timeoutMs: 5000,
    });
    expect(result).toBe("ok");
  });

  it("retries on transient failure then succeeds", async () => {
    let attempt = 0;
    const result = await withRetry(
      () => {
        attempt++;
        if (attempt < 3) throw new Error("ECONNRESET");
        return Promise.resolve("recovered");
      },
      { maxRetries: 5, baseDelayMs: 10, maxDelayMs: 50, timeoutMs: 5000 },
    );
    expect(result).toBe("recovered");
    expect(attempt).toBe(3);
  });

  it("throws after max retries", async () => {
    await expect(
      withRetry(
        () => {
          throw new Error("always fails");
        },
        { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50, timeoutMs: 5000 },
      ),
    ).rejects.toThrow("always fails");
  });
});
