import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendDailyMemory,
  loadRecentDailyMemory,
  searchMemory,
} from "./memory.js";

describe("memory", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ft-memory-test-"));
    await mkdir(join(dir, "workspace", "memory"), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("appendDailyMemory", () => {
    it("creates dated file and appends timestamped entry", async () => {
      await appendDailyMemory(dir, "First observation");

      const dateStr = new Date().toISOString().slice(0, 10);
      const content = await readFile(
        join(dir, "workspace", "memory", `${dateStr}.md`),
        "utf-8",
      );
      expect(content).toContain(`# Daily Memory — ${dateStr}`);
      expect(content).toContain("First observation");
      expect(content).toMatch(/### \d{2}:\d{2}:\d{2}/);
    });

    it("appends to existing file without overwriting", async () => {
      await appendDailyMemory(dir, "Entry one");
      await appendDailyMemory(dir, "Entry two");

      const dateStr = new Date().toISOString().slice(0, 10);
      const content = await readFile(
        join(dir, "workspace", "memory", `${dateStr}.md`),
        "utf-8",
      );
      expect(content).toContain("Entry one");
      expect(content).toContain("Entry two");
    });
  });

  describe("loadRecentDailyMemory", () => {
    it("loads today + yesterday", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000)
        .toISOString()
        .slice(0, 10);

      await writeFile(
        join(dir, "workspace", "memory", `${today}.md`),
        "# Today\nToday's notes",
        "utf-8",
      );
      await writeFile(
        join(dir, "workspace", "memory", `${yesterday}.md`),
        "# Yesterday\nYesterday's notes",
        "utf-8",
      );

      const result = await loadRecentDailyMemory(dir, 2);
      expect(result).toContain("Today's notes");
      expect(result).toContain("Yesterday's notes");
    });

    it("returns empty string when no files exist", async () => {
      const result = await loadRecentDailyMemory(dir, 2);
      expect(result).toBe("");
    });
  });

  describe("searchMemory", () => {
    it("finds text in markdown files", async () => {
      await writeFile(
        join(dir, "workspace", "memory", "2025-01-01.md"),
        "# Notes\nDecided to use PostgreSQL for the database layer.",
        "utf-8",
      );

      const results = await searchMemory(dir, "PostgreSQL");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippet).toContain("PostgreSQL");
    });

    it("finds text in JSON session notes", async () => {
      await mkdir(join(dir, "workspace", "memory", "session-notes"), {
        recursive: true,
      });
      await writeFile(
        join(
          dir,
          "workspace",
          "memory",
          "session-notes",
          "2025-01-01-post.json",
        ),
        JSON.stringify([
          { task: "post", response: "Posted about blockchain governance" },
        ]),
        "utf-8",
      );

      const results = await searchMemory(dir, "blockchain governance");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippet).toContain("blockchain");
    });

    it("returns results sorted by relevance", async () => {
      await writeFile(
        join(dir, "workspace", "memory", "a.md"),
        "token token token token",
        "utf-8",
      );
      await writeFile(
        join(dir, "workspace", "memory", "b.md"),
        "token",
        "utf-8",
      );

      const results = await searchMemory(dir, "token");
      expect(results.length).toBe(2);
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    });

    it("returns empty array for no matches", async () => {
      await writeFile(
        join(dir, "workspace", "memory", "test.md"),
        "Nothing relevant here",
        "utf-8",
      );

      const results = await searchMemory(dir, "xyznonexistent");
      expect(results).toEqual([]);
    });

    it("respects max_results limit", async () => {
      for (let i = 0; i < 5; i++) {
        await writeFile(
          join(dir, "workspace", "memory", `file${i}.md`),
          `match keyword here in file ${i}`,
          "utf-8",
        );
      }

      const results = await searchMemory(dir, "keyword", { maxResults: 2 });
      expect(results.length).toBe(2);
    });

    it("searches MEMORY.md", async () => {
      await writeFile(
        join(dir, "workspace", "MEMORY.md"),
        "# Long-Term Memory\n\nPrefer concise responses. Founder likes brevity.",
        "utf-8",
      );

      const results = await searchMemory(dir, "brevity");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].file).toContain("MEMORY.md");
    });

    it("searches reflections directory", async () => {
      await mkdir(join(dir, "workspace", "reflections"), { recursive: true });
      await writeFile(
        join(dir, "workspace", "reflections", "2025-01-01.md"),
        "Reflection: engagement improved after shorter posts.",
        "utf-8",
      );

      const results = await searchMemory(dir, "engagement");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].file).toContain("reflections");
    });

    it("searches strategy directory", async () => {
      await mkdir(join(dir, "strategy"), { recursive: true });
      await writeFile(
        join(dir, "strategy", "2025-01-01.md"),
        "Strategy: focus on developer community growth.",
        "utf-8",
      );

      const results = await searchMemory(dir, "developer community");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].file).toContain("strategy");
    });
  });
});
