import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";
import { createTempWorkspace } from "../test/helpers/temp-workspace.js";

describe("loadConfig", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const workspace = await createTempWorkspace();
    dir = workspace.dir;
    cleanup = workspace.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("loads config from a valid workspace", async () => {
    const config = await loadConfig(dir);
    expect(config.llm.provider).toBe("claude_api");
    expect(config.llm.model).toBe("claude-sonnet-4-20250514");
  });

  it("reads module enabled flags", async () => {
    const config = await loadConfig(dir);
    expect(config.modules.farcaster?.enabled).toBe(false);
    expect(config.modules.database?.enabled).toBe(false);
  });

  it("reads channel config", async () => {
    const config = await loadConfig(dir);
    expect(config.channels.telegram?.enabled).toBe(false);
  });

  it("reads heartbeat config", async () => {
    const config = await loadConfig(dir);
    expect(config.heartbeat.enabled).toBe(false);
  });
});
