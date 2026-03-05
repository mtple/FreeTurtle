import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  id: string;
  runId: string;
  toolName: string;
  reason: string;
  input: Record<string, unknown>; // redacted
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  rejectReason?: string;
  expiresAt: string;
}

const POLL_INTERVAL_MS = 2000;

export class ApprovalManager {
  private dir: string; // workspace/approvals/

  constructor(dir: string) {
    this.dir = join(dir, "workspace", "approvals");
  }

  async createRequest(opts: {
    runId: string;
    toolName: string;
    reason: string;
    input: Record<string, unknown>;
    timeoutSeconds: number;
  }): Promise<ApprovalRequest> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + opts.timeoutSeconds * 1000);

    const req: ApprovalRequest = {
      id: randomUUID(),
      runId: opts.runId,
      toolName: opts.toolName,
      reason: opts.reason,
      input: opts.input,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await this.save(req);
    return req;
  }

  /**
   * Polls the approval file until the status changes from "pending" or the
   * timeout elapses. Returns the final state of the approval request.
   */
  async waitForDecision(id: string, timeoutMs: number): Promise<ApprovalRequest> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const req = await this.load(id);
      if (!req) {
        throw new Error(`Approval request ${id} not found`);
      }

      // Check if expired by time
      if (new Date(req.expiresAt).getTime() <= Date.now() && req.status === "pending") {
        return this.expire(id);
      }

      if (req.status !== "pending") {
        return req;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    // Timed out waiting — expire the request
    return this.expire(id);
  }

  async approve(id: string, decidedBy?: string): Promise<ApprovalRequest> {
    const req = await this.load(id);
    if (!req) throw new Error(`Approval request ${id} not found`);
    if (req.status !== "pending") {
      throw new Error(`Approval request ${id} is already ${req.status}`);
    }

    req.status = "approved";
    req.decidedAt = new Date().toISOString();
    if (decidedBy) req.decidedBy = decidedBy;

    await this.save(req);
    return req;
  }

  async reject(
    id: string,
    reason?: string,
    decidedBy?: string,
  ): Promise<ApprovalRequest> {
    const req = await this.load(id);
    if (!req) throw new Error(`Approval request ${id} not found`);
    if (req.status !== "pending") {
      throw new Error(`Approval request ${id} is already ${req.status}`);
    }

    req.status = "rejected";
    req.decidedAt = new Date().toISOString();
    if (reason) req.rejectReason = reason;
    if (decidedBy) req.decidedBy = decidedBy;

    await this.save(req);
    return req;
  }

  async expire(id: string): Promise<ApprovalRequest> {
    const req = await this.load(id);
    if (!req) throw new Error(`Approval request ${id} not found`);
    if (req.status !== "pending") {
      // Already decided, just return as-is
      return req;
    }

    req.status = "expired";
    req.decidedAt = new Date().toISOString();

    await this.save(req);
    return req;
  }

  async list(status?: ApprovalStatus): Promise<ApprovalRequest[]> {
    await mkdir(this.dir, { recursive: true });

    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }

    const results: ApprovalRequest[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const id = file.replace(".json", "");
      const req = await this.load(id);
      if (!req) continue;
      if (status && req.status !== status) continue;
      results.push(req);
    }

    // Sort by creation time descending
    results.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return results;
  }

  async get(id: string): Promise<ApprovalRequest | null> {
    return this.load(id);
  }

  private async save(req: ApprovalRequest): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const filePath = this.approvalPath(req.id);
    await writeFile(filePath, JSON.stringify(req, null, 2), "utf-8");
  }

  private async load(id: string): Promise<ApprovalRequest | null> {
    const filePath = this.approvalPath(id);
    try {
      const data = await readFile(filePath, "utf-8");
      return JSON.parse(data) as ApprovalRequest;
    } catch {
      return null;
    }
  }

  private approvalPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }
}
