import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ApprovalManager } from "./approval.js";
import { createTempWorkspace } from "../test/helpers/temp-workspace.js";

describe("ApprovalManager", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let manager: ApprovalManager;

  beforeEach(async () => {
    const workspace = await createTempWorkspace();
    dir = workspace.dir;
    cleanup = workspace.cleanup;
    manager = new ApprovalManager(dir);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("creates a pending approval request", async () => {
    const req = await manager.createRequest({
      runId: "run-1",
      toolName: "run_command",
      reason: "test",
      input: { command: "ls" },
      timeoutSeconds: 60,
    });

    expect(req.id).toBeTruthy();
    expect(req.status).toBe("pending");
    expect(req.toolName).toBe("run_command");
  });

  it("approves a request", async () => {
    const req = await manager.createRequest({
      runId: "run-1",
      toolName: "run_command",
      reason: "test",
      input: {},
      timeoutSeconds: 60,
    });

    const approved = await manager.approve(req.id, "founder");
    expect(approved.status).toBe("approved");
    expect(approved.decidedBy).toBe("founder");
    expect(approved.decidedAt).toBeTruthy();
  });

  it("rejects a request with reason", async () => {
    const req = await manager.createRequest({
      runId: "run-1",
      toolName: "run_command",
      reason: "test",
      input: {},
      timeoutSeconds: 60,
    });

    const rejected = await manager.reject(req.id, "too dangerous", "founder");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectReason).toBe("too dangerous");
  });

  it("lists pending requests", async () => {
    await manager.createRequest({
      runId: "run-1",
      toolName: "tool_a",
      reason: "test",
      input: {},
      timeoutSeconds: 60,
    });

    const req2 = await manager.createRequest({
      runId: "run-1",
      toolName: "tool_b",
      reason: "test",
      input: {},
      timeoutSeconds: 60,
    });

    await manager.approve(req2.id);

    const pending = await manager.list("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].toolName).toBe("tool_a");
  });

  it("throws when approving an already-approved request", async () => {
    const req = await manager.createRequest({
      runId: "run-1",
      toolName: "run_command",
      reason: "test",
      input: {},
      timeoutSeconds: 60,
    });

    await manager.approve(req.id);
    await expect(manager.approve(req.id)).rejects.toThrow("already approved");
  });

  it("waitForDecision resolves when approved externally", async () => {
    const req = await manager.createRequest({
      runId: "run-1",
      toolName: "run_command",
      reason: "test",
      input: {},
      timeoutSeconds: 60,
    });

    // Approve after a short delay (simulates user replying "yes")
    setTimeout(() => manager.approve(req.id, "channel"), 100);

    const decision = await manager.waitForDecision(req.id, 5000);
    expect(decision.status).toBe("approved");
  });

  it("waitForDecision expires after timeout", async () => {
    const req = await manager.createRequest({
      runId: "run-1",
      toolName: "run_command",
      reason: "test",
      input: {},
      timeoutSeconds: 1, // expires in 1s
    });

    const decision = await manager.waitForDecision(req.id, 3000);
    expect(decision.status).toBe("expired");
  });
});
