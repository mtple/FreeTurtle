import { execSync, spawn } from "node:child_process";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

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

  // If systemd is managing the daemon, stop it via systemd to prevent auto-restart
  if (isSystemdManaged()) {
    execSync("systemctl --user stop freeturtle", { stdio: "inherit" });
  } else {
    process.kill(pid, "SIGTERM");
  }

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

function findBin(): string {
  try {
    return execSync("which freeturtle", { encoding: "utf-8" }).trim();
  } catch {
    return "freeturtle";
  }
}

export function isSystemdManaged(): boolean {
  const servicePath = join(
    homedir(),
    ".config/systemd/user/freeturtle.service",
  );
  if (!existsSync(servicePath)) return false;
  try {
    const status = execSync("systemctl --user is-enabled freeturtle 2>/dev/null", {
      encoding: "utf-8",
    }).trim();
    return status === "enabled";
  } catch {
    return false;
  }
}

export function startDaemon(dir: string): void {
  if (isSystemdManaged()) {
    execSync("systemctl --user restart freeturtle", { stdio: "inherit" });
    return;
  }
  const bin = findBin();
  const escaped = dir.replace(/'/g, "'\\''");
  execSync(
    `nohup ${bin} start --dir '${escaped}' </dev/null >/dev/null 2>&1 &`,
    { shell: "/bin/sh" },
  );
}

export function stopDaemonService(): void {
  if (isSystemdManaged()) {
    execSync("systemctl --user stop freeturtle", { stdio: "inherit" });
  }
}

/**
 * Schedule a daemon start after a delay (seconds).
 * Used by self-restart so the old process can fully exit and release ports
 * before the new process tries to bind them.
 */
export function startDaemonDelayed(dir: string, delaySec: number): void {
  const bin = findBin();
  // Use a detached shell that sleeps then starts the daemon
  const child = spawn("sh", ["-c", `sleep ${delaySec} && exec ${bin} start --dir '${dir}'`], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
