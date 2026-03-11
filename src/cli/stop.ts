import { getDaemonPid, stopDaemon } from "./daemon-utils.js";

export async function runStop(dir: string): Promise<void> {
  const pid = getDaemonPid(dir);
  if (!pid) {
    console.log("Daemon is not running.");
    return;
  }

  stopDaemon(pid);
  console.log("Daemon stopped.");
}
