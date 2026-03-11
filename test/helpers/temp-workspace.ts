import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Creates an isolated temp workspace for testing.
 * Mimics the structure of ~/.freeturtle/
 */
export async function createTempWorkspace(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "freeturtle-test-"));

  // Create standard subdirectories
  await mkdir(join(dir, "workspace"), { recursive: true });
  await mkdir(join(dir, "workspace", "memory"), { recursive: true });
  await mkdir(join(dir, "workspace", "approvals"), { recursive: true });
  await mkdir(join(dir, "workspace", "audit"), { recursive: true });

  // Write minimal soul.md (at root, not workspace)
  await writeFile(
    join(dir, "soul.md"),
    "# Test CEO\nYou are a test agent.",
    "utf-8",
  );

  // Write minimal config.md (at root, not workspace)
  await writeFile(
    join(dir, "config.md"),
    [
      "# Config",
      "## LLM",
      "- provider: claude_api",
      "- model: claude-sonnet-4-20250514",
      "",
      "## Modules",
      "### farcaster",
      "- enabled: false",
      "### database",
      "- enabled: false",
      "### github",
      "- enabled: false",
      "### onchain",
      "- enabled: false",
      "### gmail",
      "- enabled: false",
      "",
      "## Channels",
      "### telegram",
      "- enabled: false",
      "",
      "## Cron",
      "",
      "## Heartbeat",
      "- enabled: false",
    ].join("\n"),
    "utf-8",
  );

  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
