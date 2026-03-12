import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, dirname, relative } from "node:path";

function memoryPath(dir: string, filename: string): string {
  return join(dir, "workspace", "memory", filename);
}

export async function readMemoryFile(dir: string, filename: string): Promise<string | null> {
  try {
    return await readFile(memoryPath(dir, filename), "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function writeMemoryFile(dir: string, filename: string, content: string): Promise<void> {
  const filePath = memoryPath(dir, filename);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

export async function appendToJsonArray(dir: string, filename: string, entry: unknown): Promise<void> {
  const existing = await readMemoryFile(dir, filename);
  let arr: unknown[];
  try {
    arr = existing ? JSON.parse(existing) : [];
  } catch {
    arr = [];
  }
  if (!Array.isArray(arr)) arr = [];
  arr.push(entry);
  await writeMemoryFile(dir, filename, JSON.stringify(arr, null, 2));
}

// --- Daily Memory ---

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function dailyMemoryPath(dir: string, dateStr: string): string {
  return memoryPath(dir, `${dateStr}.md`);
}

export async function appendDailyMemory(dir: string, content: string): Promise<void> {
  const dateStr = todayDateStr();
  const filePath = dailyMemoryPath(dir, dateStr);
  await mkdir(dirname(filePath), { recursive: true });

  const timestamp = new Date().toISOString().slice(11, 19);
  const entry = `\n### ${timestamp}\n${content}\n`;

  let existing = "";
  try {
    existing = await readFile(filePath, "utf-8");
  } catch (err: unknown) {
    if (!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT")) {
      throw err;
    }
    // File doesn't exist yet — start with header
    existing = `# Daily Memory — ${dateStr}\n`;
  }

  await writeFile(filePath, existing + entry, "utf-8");
}

export async function loadRecentDailyMemory(dir: string, days = 2): Promise<string> {
  const parts: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const filePath = dailyMemoryPath(dir, dateStr);
    try {
      const content = await readFile(filePath, "utf-8");
      parts.push(content);
    } catch {
      // file doesn't exist, skip
    }
  }
  return parts.join("\n---\n");
}

// --- Memory Search ---

export interface MemorySearchResult {
  file: string;
  snippet: string;
  line: number;
  score: number;
}

async function collectFiles(baseDir: string, paths: string[]): Promise<string[]> {
  const fileSet = new Set<string>();
  for (const p of paths) {
    const full = join(baseDir, p);
    try {
      const s = await stat(full);
      if (s.isDirectory()) {
        await collectFilesRecursive(full, fileSet);
      } else if (s.isFile()) {
        fileSet.add(full);
      }
    } catch {
      // doesn't exist, skip
    }
  }
  return [...fileSet];
}

async function collectFilesRecursive(dir: string, files: Set<string>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFilesRecursive(full, files);
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".json"))) {
      files.add(full);
    }
  }
}

function scoreChunk(lines: string[], queryTerms: string[]): number {
  const text = lines.join(" ").toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    // Count occurrences
    let idx = 0;
    while (true) {
      idx = text.indexOf(term, idx);
      if (idx === -1) break;
      score += 1;
      idx += term.length;
    }
  }
  return score;
}

export async function searchMemory(
  dir: string,
  query: string,
  options?: { maxResults?: number },
): Promise<MemorySearchResult[]> {
  const maxResults = options?.maxResults ?? 10;
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (queryTerms.length === 0) return [];

  const searchPaths = [
    "workspace/memory",
    "workspace/MEMORY.md",
    "workspace/reflections",
    "strategy",
  ];

  const files = await collectFiles(dir, searchPaths);
  const results: MemorySearchResult[] = [];

  for (const filePath of files) {
    try {
      const content = await readFile(filePath, "utf-8");
      const relPath = relative(dir, filePath);

      if (filePath.endsWith(".json")) {
        // Search stringified JSON entries
        try {
          const parsed = JSON.parse(content);
          const entries = Array.isArray(parsed) ? parsed : [parsed];
          for (let i = 0; i < entries.length; i++) {
            const text = JSON.stringify(entries[i]);
            const score = scoreChunk([text], queryTerms);
            if (score > 0) {
              results.push({
                file: relPath,
                snippet: text.slice(0, 500),
                line: i + 1,
                score,
              });
            }
          }
        } catch {
          // invalid JSON, search as text
          const lines = content.split("\n");
          searchLines(lines, queryTerms, relPath, results);
        }
      } else {
        const lines = content.split("\n");
        searchLines(lines, queryTerms, relPath, results);
      }
    } catch {
      // can't read file, skip
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

function searchLines(
  lines: string[],
  queryTerms: string[],
  relPath: string,
  results: MemorySearchResult[],
): void {
  const chunkSize = 20;
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunk = lines.slice(i, i + chunkSize);
    const score = scoreChunk(chunk, queryTerms);
    if (score > 0) {
      results.push({
        file: relPath,
        snippet: chunk.join("\n").slice(0, 500),
        line: i + 1,
        score,
      });
    }
  }
}
