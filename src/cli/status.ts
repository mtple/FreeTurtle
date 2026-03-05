import net from "node:net";
import { join } from "node:path";

export async function runStatus(dir: string): Promise<void> {
  const sockPath = join(dir, "daemon.sock");

  const response = await ipcRequest(sockPath, "status");
  const status = JSON.parse(response);

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

export function ipcRequest(sockPath: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(sockPath, () => {
      client.write(command);
      client.end();
    });

    let data = "";
    client.on("data", (chunk) => {
      data += chunk.toString();
    });
    client.on("end", () => resolve(data));
    client.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("FreeTurtle daemon is not running."));
      } else {
        reject(err);
      }
    });
  });
}
