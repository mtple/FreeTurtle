import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FreeTurtleDaemon } from "../daemon.js";

export async function runStart(dir: string): Promise<void> {
  // Check for existing daemon
  const pidPath = join(dir, "daemon.pid");
  try {
    const pid = parseInt(await readFile(pidPath, "utf-8"), 10);
    try {
      process.kill(pid, 0); // Check if process exists
      console.error(
        `FreeTurtle is already running (PID ${pid}). Stop it first or run 'freeturtle status'.`
      );
      process.exit(1);
    } catch {
      // Process doesn't exist, stale PID file — continue
    }
  } catch {
    // No PID file — continue
  }

  const daemon = new FreeTurtleDaemon(dir);
  await daemon.start();
}
