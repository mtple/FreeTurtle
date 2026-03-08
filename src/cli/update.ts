import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
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

function startDaemon(dir: string): void {
  const nodePath = execSync("which node", { encoding: "utf-8" }).trim();
  const bin = join(__dirname, "../../bin/freeturtle.js");
  execSync(`${nodePath} ${bin} start --dir ${dir} &`, {
    stdio: "ignore",
    shell: "/bin/sh",
  });
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
      startDaemon(workspaceDir);
      // Give it a moment to write PID
      execSync("sleep 1");
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
