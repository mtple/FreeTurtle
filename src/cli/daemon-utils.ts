import { execSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";

export function getDaemonPid(dir: string): number | null {
  try {
    const pidPath = join(dir, "daemon.pid");
    const raw = readFileSync(pidPath, "utf-8");
    const pid = parseInt(raw, 10);
    process.kill(pid, 0); // throws if not running
    return pid;
  } catch {
    return null;
  }
}

export function stopDaemon(pid: number): void {
  console.log(`Stopping daemon (PID ${pid})...`);
  process.kill(pid, "SIGTERM");

  // Wait for process to exit (up to 10 seconds)
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      execSync("sleep 0.5");
    } catch {
      return; // process exited
    }
  }
  // Force kill if still running
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

export function startDaemon(dir: string): void {
  let bin: string;
  try {
    bin = execSync("which freeturtle", { encoding: "utf-8" }).trim();
  } catch {
    bin = "freeturtle";
  }

  const escaped = dir.replace(/'/g, "'\\''");
  execSync(
    `nohup ${bin} start --dir '${escaped}' </dev/null >/dev/null 2>&1 &`,
    { shell: "/bin/sh" },
  );
}
