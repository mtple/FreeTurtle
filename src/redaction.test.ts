import { describe, it, expect } from "vitest";
import { redact } from "./redaction.js";

describe("redact", () => {
  it("redacts string values that look like secrets", () => {
    const input = { api_key: "sk-abc123xyz", name: "test" };
    const result = redact(input) as Record<string, unknown>;
    expect(result.api_key).toBe("***");
    expect(result.name).toBe("test");
  });

  it("redacts nested objects", () => {
    const input = { config: { password: "hunter2" } };
    const result = redact(input) as Record<string, unknown>;
    const config = result.config as Record<string, unknown>;
    expect(config.password).toBe("***");
  });

  it("handles non-object inputs", () => {
    expect(redact("hello")).toBe("hello");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
  });

  it("redacts keys containing 'token'", () => {
    const input = { access_token: "eyJhbGci..." };
    const result = redact(input) as Record<string, unknown>;
    expect(result.access_token).toBe("***");
  });

  it("redacts keys containing 'secret'", () => {
    const input = { client_secret: "abc123" };
    const result = redact(input) as Record<string, unknown>;
    expect(result.client_secret).toBe("***");
  });
});
