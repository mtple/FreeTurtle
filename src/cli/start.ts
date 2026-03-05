import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { FreeTurtleDaemon } from "../daemon.js";

export async function runStart(
  dir: string,
  options: { chat?: boolean } = {}
): Promise<void> {
  // Check for existing daemon
  const pidPath = join(dir, "daemon.pid");
  try {
    const pid = parseInt(await readFile(pidPath, "utf-8"), 10);
    try {
      process.kill(pid, 0);
      console.error(
        `FreeTurtle is already running (PID ${pid}). Stop it first or run 'freeturtle status'.`
      );
      process.exit(1);
    } catch {
      // Stale PID file — clean it up
      await unlink(pidPath).catch(() => {});
    }
  } catch {
    // No PID file
  }

  const daemon = new FreeTurtleDaemon(dir, { chat: options.chat ?? false });
  await daemon.start();
}
