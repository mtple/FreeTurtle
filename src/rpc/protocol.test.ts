import { describe, it, expect } from "vitest";
import {
  makeRequest,
  makeResponse,
  makeError,
  parseFrame,
} from "./protocol.js";

describe("RPC protocol", () => {
  it("creates a request frame", () => {
    const req = makeRequest("status", { verbose: true });
    expect(req.type).toBe("req");
    expect(req.method).toBe("status");
    expect(req.params).toEqual({ verbose: true });
    expect(req.id).toBeTruthy();
  });

  it("creates a success response frame", () => {
    const res = makeResponse("req-1", { status: "ok" });
    expect(res.type).toBe("res");
    expect(res.id).toBe("req-1");
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ status: "ok" });
  });

  it("creates an error response frame", () => {
    const res = makeError("req-1", "something broke");
    expect(res.type).toBe("res");
    expect(res.id).toBe("req-1");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("something broke");
  });

  it("round-trips a request through parseFrame", () => {
    const req = makeRequest("send", { message: "hello" });
    const json = JSON.stringify(req);
    const parsed = parseFrame(json);
    expect(parsed).toEqual(req);
  });

  it("round-trips a response through parseFrame", () => {
    const res = makeResponse("id-1", "ok");
    const json = JSON.stringify(res);
    const parsed = parseFrame(json);
    expect(parsed).toEqual(res);
  });

  it("returns null for invalid JSON", () => {
    expect(parseFrame("not json")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseFrame('"hello"')).toBeNull();
  });

  it("returns null for missing type field", () => {
    expect(parseFrame('{"id":"1","method":"foo"}')).toBeNull();
  });
});
