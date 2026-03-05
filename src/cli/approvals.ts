import net from "node:net";
import { join } from "node:path";

async function sendIpc(dir: string, command: string): Promise<string> {
  const sockPath = join(dir, "daemon.sock");

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
      reject(
        new Error(
          `Cannot connect to daemon. Is FreeTurtle running?\n${err.message}`
        )
      );
    });
  });
}

export async function runApprove(dir: string, id: string): Promise<void> {
  const response = await sendIpc(dir, `approve ${id}`);
  console.log(response);
}

export async function runReject(
  dir: string,
  id: string,
  reason?: string,
): Promise<void> {
  const cmd = reason ? `reject ${id} ${reason}` : `reject ${id}`;
  const response = await sendIpc(dir, cmd);
  console.log(response);
}

export async function runListApprovals(dir: string): Promise<void> {
  const response = await sendIpc(dir, "approvals");
  console.log(response);
}
