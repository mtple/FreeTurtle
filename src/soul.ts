import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadSoul(dir: string): Promise<string> {
  const soulPath = join(dir, "soul.md");
  try {
    return await readFile(soulPath, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`soul.md not found at ${soulPath}. Run 'freeturtle init' to create one.`);
    }
    throw err;
  }
}
