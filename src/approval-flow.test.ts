import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskRunner } from "./runner.js";
import { MockLLMClient } from "../test/helpers/mock-llm.js";
import { createTempWorkspace } from "../test/helpers/temp-workspace.js";
import { getDefaultPolicy } from "./policy.js";
import { createLogger } from "./logger.js";
import type { FreeTurtleModule, ToolDefinition } from "./modules/types.js";

// Module with a tool that REQUIRES approval (delete_cast)
class FakeFarcasterModule implements FreeTurtleModule {
  name = "farcaster";
  description = "Fake farcaster for testing";
  executed: Array<{ name: string; input: Record<string, unknown> }> = [];

  async initialize() {}

  getTools(): ToolDefinition[] {
    return [
      {
        name: "delete_cast",
        description: "Delete a Farcaster cast",
        input_schema: {
          type: "object",
          properties: { hash: { type: "string" } },
          required: ["hash"],
        },
      },
    ];
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    this.executed.push({ name, input });
    return `Deleted cast ${input.hash}`;
  }
}

// Module with run_command (does NOT require approval anymore)
class FakeShellModule implements FreeTurtleModule {
  name = "shell";
  description = "Fake shell for testing";
  executed: Array<{ name: string; input: Record<string, unknown> }> = [];

  async initialize() {}

  getTools(): ToolDefinition[] {
    return [
      {
        name: "run_command",
        description: "Run a shell command",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    ];
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    this.executed.push({ name, input });
    return `Command output: executed "${input.command}"`;
  }
}

// A module whose tool does NOT require approval
class FakeWorkspaceModule implements FreeTurtleModule {
  name = "workspace";
  description = "Fake workspace for testing";
  executed: Array<{ name: string; input: Record<string, unknown> }> = [];

  async initialize() {}

  getTools(): ToolDefinition[] {
    return [
      {
        name: "read_file",
        description: "Read a file",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ];
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    this.executed.push({ name, input });
    return `File contents of ${input.path}`;
  }
}

let workspace: { dir: string; cleanup: () => Promise<void> };
let logger: ReturnType<typeof createLogger>;

beforeEach(async () => {
  workspace = await createTempWorkspace();
  logger = createLogger("test");
});

afterEach(async () => {
  await workspace.cleanup();
});

describe("Non-blocking approval flow (integration)", () => {
  it("delete_cast requires approval and returns immediately without executing", async () => {
    const llm = new MockLLMClient();
    const farcaster = new FakeFarcasterModule();
    const policy = getDefaultPolicy();

    llm.addToolCall(
      "delete_cast",
      { hash: "0xabc123" },
      "Done.",
    );

    const approvalMessages: string[] = [];

    const runner = new TaskRunner(workspace.dir, llm as any, [farcaster], logger, {
      policy,
      onApprovalNeeded: (msg) => approvalMessages.push(msg),
      onFollowup: () => {},
    });

    await runner.runMessage("delete that cast", "test-channel");

    // CRITICAL: The tool must NOT have been executed — it's behind approval
    expect(farcaster.executed).toHaveLength(0);

    // An approval notification must have been sent to the founder
    expect(approvalMessages).toHaveLength(1);
    expect(approvalMessages[0]).toContain("delete_cast");
    expect(approvalMessages[0]).toMatch(/yes|approve/i);

    // There must be exactly one pending approval request on disk
    const approvalMgr = runner.getApprovalManager();
    const pending = await approvalMgr.list("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].toolName).toBe("delete_cast");
    expect(pending[0].status).toBe("pending");
  });

  it("after approval is granted, the tool executes and followup is sent", async () => {
    const llm = new MockLLMClient();
    const farcaster = new FakeFarcasterModule();
    const policy = getDefaultPolicy();

    llm.addToolCall(
      "delete_cast",
      { hash: "0xabc123" },
      "Done.",
    );

    const followups: string[] = [];

    const runner = new TaskRunner(workspace.dir, llm as any, [farcaster], logger, {
      policy,
      onApprovalNeeded: () => {},
      onFollowup: (msg) => followups.push(msg),
    });

    // Run the message — returns immediately without executing
    await runner.runMessage("delete that cast", "test-channel");
    expect(farcaster.executed).toHaveLength(0);

    // Now approve the pending request
    const approvalMgr = runner.getApprovalManager();
    const pending = await approvalMgr.list("pending");
    expect(pending).toHaveLength(1);

    await approvalMgr.approve(pending[0].id, "founder");

    // Wait for the fire-and-forget to pick up the approval
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // CRITICAL: The tool must now have been executed exactly once
    expect(farcaster.executed).toHaveLength(1);
    expect(farcaster.executed[0].name).toBe("delete_cast");
    expect(farcaster.executed[0].input.hash).toBe("0xabc123");

    // CRITICAL: A followup message must have been sent with the tool's output
    expect(followups).toHaveLength(1);
    expect(followups[0]).toContain("Deleted cast");
  });

  it("rejected approval sends rejection followup and does NOT execute", async () => {
    const llm = new MockLLMClient();
    const farcaster = new FakeFarcasterModule();
    const policy = getDefaultPolicy();

    llm.addToolCall(
      "delete_cast",
      { hash: "0xabc123" },
      "Done.",
    );

    const followups: string[] = [];

    const runner = new TaskRunner(workspace.dir, llm as any, [farcaster], logger, {
      policy,
      onApprovalNeeded: () => {},
      onFollowup: (msg) => followups.push(msg),
    });

    await runner.runMessage("delete that cast", "test-channel");
    expect(farcaster.executed).toHaveLength(0);

    const approvalMgr = runner.getApprovalManager();
    const pending = await approvalMgr.list("pending");
    expect(pending).toHaveLength(1);

    await approvalMgr.reject(pending[0].id, "Absolutely not");

    await new Promise((resolve) => setTimeout(resolve, 3000));

    // CRITICAL: Tool must NOT have executed after rejection
    expect(farcaster.executed).toHaveLength(0);

    // CRITICAL: Followup must mention rejection
    expect(followups).toHaveLength(1);
    expect(followups[0].toLowerCase()).toContain("rejected");

    // The approval record on disk must reflect rejection
    const all = await approvalMgr.list();
    expect(all[0].status).toBe("rejected");
  });

  it("run_command executes immediately without approval", async () => {
    const llm = new MockLLMClient();
    const shell = new FakeShellModule();
    const policy = getDefaultPolicy();

    llm.addToolCall(
      "run_command",
      { command: "npm install vercel" },
      "Done.",
    );

    const approvalMessages: string[] = [];

    const runner = new TaskRunner(workspace.dir, llm as any, [shell], logger, {
      policy,
      onApprovalNeeded: (msg) => approvalMessages.push(msg),
      onFollowup: () => {},
    });

    await runner.runMessage("install vercel", "test-channel");

    // CRITICAL: run_command must execute immediately — no approval
    expect(shell.executed).toHaveLength(1);
    expect(shell.executed[0].name).toBe("run_command");
    expect(shell.executed[0].input.command).toBe("npm install vercel");

    // No approval notifications should have been sent
    expect(approvalMessages).toHaveLength(0);

    // No pending approvals on disk
    const approvalMgr = runner.getApprovalManager();
    const pending = await approvalMgr.list("pending");
    expect(pending).toHaveLength(0);
  });

  it("non-approval tools execute immediately and their result reaches the LLM", async () => {
    const llm = new MockLLMClient();
    const ws = new FakeWorkspaceModule();
    const policy = getDefaultPolicy();

    llm.addToolCall(
      "read_file",
      { path: "soul.md" },
      "Done.",
    );

    const runner = new TaskRunner(workspace.dir, llm as any, [ws], logger, {
      policy,
    });

    await runner.runMessage("read soul.md", "test-channel");

    // CRITICAL: Tool must have executed immediately (no approval needed)
    expect(ws.executed).toHaveLength(1);
    expect(ws.executed[0].name).toBe("read_file");
    expect(ws.executed[0].input.path).toBe("soul.md");

    // No approval requests should exist
    const approvalMgr = runner.getApprovalManager();
    const pending = await approvalMgr.list("pending");
    expect(pending).toHaveLength(0);
  });

  it("approval-pending tool does not block subsequent messages", async () => {
    const llm = new MockLLMClient();
    const farcaster = new FakeFarcasterModule();
    const ws = new FakeWorkspaceModule();
    const policy = getDefaultPolicy();

    // First message triggers approval (delete_cast)
    llm.addToolCall(
      "delete_cast",
      { hash: "0xabc" },
      "Done.",
    );
    // Second message uses a non-approval tool
    llm.addToolCall(
      "read_file",
      { path: "config.md" },
      "Done.",
    );

    const runner = new TaskRunner(
      workspace.dir,
      llm as any,
      [farcaster, ws],
      logger,
      { policy, onApprovalNeeded: () => {}, onFollowup: () => {} },
    );

    // Record timing — both must complete quickly (not wait for approval)
    const start = Date.now();
    await runner.runMessage("delete that cast", "test-channel");
    await runner.runMessage("read config", "test-channel");
    const elapsed = Date.now() - start;

    // CRITICAL: Both messages must complete in under 5 seconds
    expect(elapsed).toBeLessThan(5000);

    // CRITICAL: read_file must have executed, delete_cast must NOT have
    expect(ws.executed).toHaveLength(1);
    expect(ws.executed[0].name).toBe("read_file");
    expect(farcaster.executed).toHaveLength(0);

    // Exactly one pending approval should exist (for delete_cast)
    const approvalMgr = runner.getApprovalManager();
    const pending = await approvalMgr.list("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].toolName).toBe("delete_cast");
  });

  it("approval followup contains actual tool output, not a generic message", async () => {
    const llm = new MockLLMClient();
    const farcaster = new FakeFarcasterModule();
    const policy = getDefaultPolicy();

    llm.addToolCall(
      "delete_cast",
      { hash: "0xdeadbeef" },
      "Done.",
    );

    const followups: string[] = [];

    const runner = new TaskRunner(workspace.dir, llm as any, [farcaster], logger, {
      policy,
      onApprovalNeeded: () => {},
      onFollowup: (msg) => followups.push(msg),
    });

    await runner.runMessage("delete cast", "test-channel");

    const approvalMgr = runner.getApprovalManager();
    const pending = await approvalMgr.list("pending");
    await approvalMgr.approve(pending[0].id, "founder");

    await new Promise((resolve) => setTimeout(resolve, 3000));

    // CRITICAL: The followup must contain the actual output from executeTool
    expect(followups).toHaveLength(1);
    expect(followups[0]).toContain("0xdeadbeef");
  });
});
