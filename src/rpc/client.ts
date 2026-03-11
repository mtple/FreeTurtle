import WebSocket from "ws";
import {
  DEFAULT_RPC_PORT,
  type RpcResponse,
  makeRequest,
  parseFrame,
} from "./protocol.js";

/**
 * Send a single RPC request to the daemon and return the result.
 * Opens a WebSocket, sends one request, waits for the matching response, closes.
 */
export async function rpcCall(
  method: string,
  params?: Record<string, unknown>,
  options?: { port?: number; timeoutMs?: number },
): Promise<unknown> {
  const port = options?.port ?? DEFAULT_RPC_PORT;
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const req = makeRequest(method, params);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`RPC call "${method}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

    ws.on("open", () => {
      ws.send(JSON.stringify(req));
    });

    ws.on("message", (raw) => {
      const frame = parseFrame(raw.toString());
      if (!frame || frame.type !== "res") return;

      const res = frame as RpcResponse;
      if (res.id !== req.id) return;

      clearTimeout(timer);
      ws.close();

      if (res.ok) {
        resolve(res.result);
      } else {
        reject(new Error(res.error ?? "Unknown RPC error"));
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
        reject(new Error("FreeTurtle daemon is not running."));
      } else {
        reject(err);
      }
    });

    ws.on("close", () => {
      clearTimeout(timer);
    });
  });
}
