import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { getDaemonPid, stopDaemon, startDaemon } from "./daemon-utils.js";

function detectPackageManager(): string {
  // Check where the freeturtle binary actually lives to detect the package manager
  try {
    const binPath = execSync("which freeturtle 2>/dev/null", { encoding: "utf-8" }).trim();
    if (binPath.includes("/pnpm/") || binPath.includes("/.pnpm")) return "pnpm";
    if (binPath.includes("/yarn/")) return "yarn";
  } catch { /* couldn't resolve binary path */ }

  // Fallback: check if pnpm knows about freeturtle
  try {
    const list = execSync("pnpm list -g --depth=0 2>/dev/null", { encoding: "utf-8" });
    if (list.includes("freeturtle")) return "pnpm";
  } catch { /* not pnpm */ }

  // Default to npm
  return "npm";
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
