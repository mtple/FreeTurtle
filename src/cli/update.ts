import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

function detectPackageManager(): string {
  // Check if installed via pnpm
  try {
    const list = execSync("pnpm list -g freeturtle 2>/dev/null", { encoding: "utf-8" });
    if (list.includes("freeturtle")) return "pnpm";
  } catch { /* not pnpm */ }

  // Check if installed via yarn
  try {
    const list = execSync("yarn global list 2>/dev/null", { encoding: "utf-8" });
    if (list.includes("freeturtle")) return "yarn";
  } catch { /* not yarn */ }

  // Default to npm
  return "npm";
}

function getDaemonPid(dir: string): number | null {
  try {
    const pidPath = join(dir, "daemon.pid");
    const raw = require("node:fs").readFileSync(pidPath, "utf-8");
    const pid = parseInt(raw, 10);
    process.kill(pid, 0); // throws if not running
    return pid;
  } catch {
    return null;
  }
}

function stopDaemon(pid: number): void {
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


export async function runUpdate(dir?: string): Promise<void> {
  const workspaceDir = dir ?? join(homedir(), ".freeturtle");
  const daemonPid = getDaemonPid(workspaceDir);

  if (daemonPid) {
    stopDaemon(daemonPid);
    console.log("Daemon stopped.\n");
  }

  const pm = detectPackageManager();
  const cmd = pm === "pnpm"
    ? "pnpm install -g freeturtle@latest"
    : pm === "yarn"
      ? "yarn global add freeturtle@latest"
      : "npm install -g freeturtle@latest";

  console.log(`Updating FreeTurtle via ${pm}...`);
  console.log(`  ${cmd}\n`);

  try {
    execSync(cmd, { stdio: "inherit" });
    console.log("\nFreeTurtle updated successfully.");
  } catch {
    console.error("\nUpdate failed. You can update manually:");
    console.error(`  ${cmd}`);
    if (daemonPid) {
      console.error("\nNote: daemon was stopped for the update. Restart with: freeturtle start");
    }
    process.exit(1);
  }

  if (daemonPid) {
    console.log("\nRestarting daemon...");
    try {
      // Resolve the *newly installed* binary so we launch the updated code,
      // not the code from the process that's currently running.
      let bin: string;
      try {
        bin = execSync("which freeturtle", { encoding: "utf-8" }).trim();
      } catch {
        bin = "freeturtle";
      }

      // Use the new binary's start command directly via nohup.
      // This ensures the new version's daemon code runs, avoiding the
      // "old code restarts old daemon" race condition.
      const escaped = workspaceDir.replace(/'/g, "'\\''");
      execSync(
        `nohup ${bin} start --dir '${escaped}' </dev/null >/dev/null 2>&1 &`,
        { shell: "/bin/sh" },
      );

      // Give it a moment to write PID
      execSync("sleep 2");
      const newPid = getDaemonPid(workspaceDir);
      if (newPid) {
        console.log(`Daemon restarted (PID ${newPid}).`);
      } else {
        console.log("Daemon started. Check status with: freeturtle status");
      }
    } catch {
      console.error("Could not restart daemon automatically.");
      console.error("Start manually with: freeturtle start");
    }
  }
}
