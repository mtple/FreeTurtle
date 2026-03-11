import { rpcCall } from "../rpc/client.js";

export async function runApprove(_dir: string, id: string): Promise<void> {
  const response = await rpcCall("approve", { id });
  console.log(JSON.stringify(response, null, 2));
}

export async function runReject(
  _dir: string,
  id: string,
  reason?: string,
): Promise<void> {
  const response = await rpcCall("reject", { id, reason });
  console.log(JSON.stringify(response, null, 2));
}

export async function runListApprovals(_dir: string): Promise<void> {
  const response = await rpcCall("approvals");
  const list = response as unknown[];
  if (!Array.isArray(list) || list.length === 0) {
    console.log("No pending approvals.");
  } else {
    console.log(JSON.stringify(list, null, 2));
  }
}
