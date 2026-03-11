/**
 * WebSocket RPC protocol — modeled after OpenClaw's Gateway protocol v3.
 *
 * Frame types:
 *   req  — client → server request
 *   res  — server → client response
 *   event — server → client push (future use)
 *
 * Default port: 18820
 */

export const DEFAULT_RPC_PORT = 18820;

export interface RpcRequest {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  type: "res";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface RpcEvent {
  type: "event";
  event: string;
  data?: unknown;
}

export type RpcFrame = RpcRequest | RpcResponse | RpcEvent;

export function makeRequest(
  method: string,
  params?: Record<string, unknown>,
): RpcRequest {
  return {
    type: "req",
    id: crypto.randomUUID(),
    method,
    params,
  };
}

export function makeResponse(
  id: string,
  result: unknown,
): RpcResponse {
  return { type: "res", id, ok: true, result };
}

export function makeError(id: string, error: string): RpcResponse {
  return { type: "res", id, ok: false, error };
}

export function parseFrame(data: string): RpcFrame | null {
  try {
    const frame = JSON.parse(data) as RpcFrame;
    if (!frame || typeof frame !== "object" || !frame.type) return null;
    return frame;
  } catch {
    return null;
  }
}
