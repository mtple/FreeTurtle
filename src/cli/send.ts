import { join } from "node:path";
import { ipcRequest } from "./status.js";

export async function runSend(dir: string, message: string): Promise<void> {
  const sockPath = join(dir, "daemon.sock");

  try {
    const response = await ipcRequest(sockPath, `send ${message}`);
    console.log(response);
  } catch (err) {
    if (err instanceof Error) {
      console.error(err.message);
    }
    process.exit(1);
  }
}
