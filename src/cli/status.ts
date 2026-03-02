import net from "node:net";
import { join } from "node:path";

export async function runStatus(dir: string): Promise<void> {
  const sockPath = join(dir, "daemon.sock");

  const response = await ipcRequest(sockPath, "status");
  const status = JSON.parse(response);

  console.log("\n  FreeTurtle Status\n");
  console.log(`  PID:      ${status.pid}`);
  console.log(`  Uptime:   ${Math.round(status.uptime)}s`);
  console.log(`  Channels: ${status.channels.join(", ") || "none"}`);

  if (status.scheduler?.tasks?.length) {
    console.log("\n  Scheduled tasks:");
    for (const task of status.scheduler.tasks) {
      const next = task.nextRun ? new Date(task.nextRun).toLocaleString() : "—";
      const state = task.running ? " (running)" : "";
      console.log(`    ${task.name}: next at ${next}${state}`);
    }
  }

  console.log();
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
