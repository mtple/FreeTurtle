import { rpcCall } from "../rpc/client.js";

export async function runSend(_dir: string, message: string): Promise<void> {
  try {
    const response = await rpcCall("send", { message }, { timeoutMs: 120_000 });
    console.log(typeof response === "string" ? response : JSON.stringify(response, null, 2));
  } catch (err) {
    if (err instanceof Error) {
      console.error(err.message);
    }
    process.exit(1);
  }
}
