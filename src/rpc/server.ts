import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { Logger } from "../logger.js";
import {
  DEFAULT_RPC_PORT,
  type RpcRequest,
  makeResponse,
  makeError,
  parseFrame,
} from "./protocol.js";

export type RpcHandler = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export class RpcServer {
  private httpServer: HttpServer;
  private wss: WebSocketServer;
  private handler: RpcHandler;
  private logger: Logger;
  private port: number;

  constructor(handler: RpcHandler, logger: Logger, port?: number) {
    this.handler = handler;
    this.logger = logger;
    this.port = port ?? DEFAULT_RPC_PORT;

    this.httpServer = createServer((_req, res) => {
      // Simple HTTP health endpoint for load balancers / uptime checks
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });

    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        this.onMessage(ws, raw.toString());
      });
      ws.on("error", (err) => {
        this.logger.warn(`RPC client error: ${err.message}`);
      });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer.on("error", reject);
      this.httpServer.listen(this.port, "127.0.0.1", () => {
        this.logger.info(`RPC server listening on ws://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  stop(): void {
    for (const client of this.wss.clients) {
      client.close();
    }
    this.wss.close();
    this.httpServer.close();
  }

  private async onMessage(ws: WebSocket, raw: string): Promise<void> {
    const frame = parseFrame(raw);
    if (!frame || frame.type !== "req") {
      ws.send(JSON.stringify(makeError("unknown", "Invalid frame")));
      return;
    }

    const req = frame as RpcRequest;
    try {
      const result = await this.handler(req.method, req.params ?? {});
      ws.send(JSON.stringify(makeResponse(req.id, result)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`RPC handler error (${req.method}): ${msg}`);
      ws.send(JSON.stringify(makeError(req.id, msg)));
    }
  }
}
