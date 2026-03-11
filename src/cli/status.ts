import { rpcCall } from "../rpc/client.js";

export async function runStatus(dir: string): Promise<void> {
  const status = (await rpcCall("status")) as {
    pid: number;
    uptime: number;
    scheduler?: { tasks?: { name: string; nextRun?: string; running?: boolean }[] };
    channels: string[];
  };

  const uptimeStr = formatUptime(status.uptime);

  console.log(`\n  \x1b[38;2;94;255;164m🐢 FreeTurtle\x1b[0m — swimming for ${uptimeStr}\n`);
  console.log(`  PID        ${status.pid}`);
  console.log(`  Channels   ${status.channels.join(", ") || "none"}`);

  if (status.scheduler?.tasks?.length) {
    console.log("\n  Scheduled tasks:");
    for (const task of status.scheduler.tasks) {
      const next = task.nextRun ? new Date(task.nextRun).toLocaleString() : "\u2014";
      const state = task.running ? " \x1b[33m(running)\x1b[0m" : "";
      console.log(`    ${task.name}: next at ${next}${state}`);
    }
  }

  console.log();
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
