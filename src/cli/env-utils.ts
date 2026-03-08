import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Upsert key=value pairs into a .env file. Creates the file if missing.
 */
export async function upsertEnv(
  dir: string,
  vars: Record<string, string>,
): Promise<void> {
  const envPath = join(dir, ".env");

  let content = "";
  try {
    content = await readFile(envPath, "utf-8");
  } catch {
    // no existing .env
  }

  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `${content.endsWith("\n") || content === "" ? "" : "\n"}${key}=${value}\n`;
    }
  }

  await mkdir(dirname(envPath), { recursive: true });
  await writeFile(envPath, content, "utf-8");
  await chmod(envPath, 0o600);
}
