import { execSync } from "node:child_process";
import { getDaemonPid, stopDaemon, startDaemon } from "./daemon-utils.js";

export async function runRestart(dir: string): Promise<void> {
  const pid = getDaemonPid(dir);
  if (!pid) {
    console.error("Daemon is not running. Use 'freeturtle start' to start it.");
    process.exit(1);
  }

  stopDaemon(pid);
  console.log("Daemon stopped.\n");

  console.log("Starting daemon...");
  startDaemon(dir);

  // Give it a moment to write PID
  execSync("sleep 2");
  const newPid = getDaemonPid(dir);
  if (newPid) {
    console.log(`Daemon restarted (PID ${newPid}).`);
  } else {
    console.log("Daemon started. Check status with: freeturtle status");
  }
}
