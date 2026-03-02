import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

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
