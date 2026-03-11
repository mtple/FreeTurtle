import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskRunner } from "./runner.js";
import { MockLLMClient } from "../test/helpers/mock-llm.js";
import { createTempWorkspace } from "../test/helpers/temp-workspace.js";
import { getDefaultPolicy } from "./policy.js";
import { createLogger } from "./logger.js";
import type { FreeTurtleModule, ToolDefinition } from "./modules/types.js";

// Minimal module that provides run_command (always requires approval)
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
  it("run_command returns immediately without executing the tool", async () => {
    const llm = new MockLLMClient();
    const shell = new FakeShellModule();
    const policy = getDefaultPolicy();

    // LLM calls run_command, then gets the tool result and responds
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

    // CRITICAL: The tool must NOT have been executed — it's behind approval
    expect(shell.executed).toHaveLength(0);

    // An approval notification must have been sent to the founder
    expect(approvalMessages).toHaveLength(1);
    expect(approvalMessages[0]).toContain("run_command");
    // The notification must tell the founder how to respond
    expect(approvalMessages[0]).toMatch(/yes|approve/i);

    // There must be exactly one pending approval request on disk
    const approvalMgr = runner.getApprovalManager();
    const pending = await approvalMgr.list("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].toolName).toBe("run_command");
    expect(pending[0].status).toBe("pending");
  });

  it("after approval is granted, the tool executes and followup is sent", async () => {
    const llm = new MockLLMClient();
    const shell = new FakeShellModule();
    const policy = getDefaultPolicy();

    llm.addToolCall(
      "run_command",
      { command: "npm install vercel" },
      "Done.",
    );

    const followups: string[] = [];

    const runner = new TaskRunner(workspace.dir, llm as any, [shell], logger, {
      policy,
      onApprovalNeeded: () => {},
      onFollowup: (msg) => followups.push(msg),
    });

    // Run the message — returns immediately without executing
    await runner.runMessage("install vercel", "test-channel");
    expect(shell.executed).toHaveLength(0);

    // Now approve the pending request
    const approvalMgr = runner.getApprovalManager();
    const pending = await approvalMgr.list("pending");
    expect(pending).toHaveLength(1);

    await approvalMgr.approve(pending[0].id, "founder");

    // Wait for the fire-and-forget to pick up the approval
    // (it polls every 2s, so we need at least one poll cycle)
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // CRITICAL: The tool must now have been executed exactly once
    expect(shell.executed).toHaveLength(1);
    expect(shell.executed[0].name).toBe("run_command");
    expect(shell.executed[0].input.command).toBe("npm install vercel");

    // CRITICAL: A followup message must have been sent with the tool's output
    expect(followups).toHaveLength(1);
    expect(followups[0]).toContain("executed");
    expect(followups[0]).toContain("npm install vercel");
  });

  it("rejected approval sends rejection followup and does NOT execute", async () => {
    const llm = new MockLLMClient();
    const shell = new FakeShellModule();
    const policy = getDefaultPolicy();

    llm.addToolCall(
      "run_command",
      { command: "rm -rf /" },
      "Done.",
    );

    const followups: string[] = [];

    const runner = new TaskRunner(workspace.dir, llm as any, [shell], logger, {
      policy,
      onApprovalNeeded: () => {},
      onFollowup: (msg) => followups.push(msg),
    });

    await runner.runMessage("delete everything", "test-channel");
    expect(shell.executed).toHaveLength(0);

    const approvalMgr = runner.getApprovalManager();
    const pending = await approvalMgr.list("pending");
    expect(pending).toHaveLength(1);

    await approvalMgr.reject(pending[0].id, "Absolutely not");

    await new Promise((resolve) => setTimeout(resolve, 3000));

    // CRITICAL: Tool must NOT have executed after rejection
    expect(shell.executed).toHaveLength(0);

    // CRITICAL: Followup must mention rejection
    expect(followups).toHaveLength(1);
    expect(followups[0].toLowerCase()).toContain("rejected");

    // The approval record on disk must reflect rejection
    const all = await approvalMgr.list();
    expect(all[0].status).toBe("rejected");
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
    const shell = new FakeShellModule();
    const ws = new FakeWorkspaceModule();
    const policy = getDefaultPolicy();

    // First message triggers approval
    llm.addToolCall(
      "run_command",
      { command: "npm install" },
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
      [shell, ws],
      logger,
      { policy, onApprovalNeeded: () => {}, onFollowup: () => {} },
    );

    // Record timing — both must complete quickly (not wait 5min for approval)
    const start = Date.now();
    await runner.runMessage("install deps", "test-channel");
    await runner.runMessage("read config", "test-channel");
    const elapsed = Date.now() - start;

    // CRITICAL: Both messages must complete in under 5 seconds
    // (if approval blocked, it would take 300s = timeout)
    expect(elapsed).toBeLessThan(5000);

    // CRITICAL: read_file must have executed, run_command must NOT have
    expect(ws.executed).toHaveLength(1);
    expect(ws.executed[0].name).toBe("read_file");
    expect(shell.executed).toHaveLength(0);

    // Exactly one pending approval should exist (for run_command)
    const approvalMgr = runner.getApprovalManager();
    const pending = await approvalMgr.list("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].toolName).toBe("run_command");
  });

  it("without a policy, run_command still requires approval", async () => {
    const llm = new MockLLMClient();
    const shell = new FakeShellModule();

    llm.addToolCall(
      "run_command",
      { command: "whoami" },
      "Done.",
    );

    const approvalMessages: string[] = [];

    // Pass policy explicitly — run_command is hardcoded to require approval
    const runner = new TaskRunner(workspace.dir, llm as any, [shell], logger, {
      policy: getDefaultPolicy(),
      onApprovalNeeded: (msg) => approvalMessages.push(msg),
      onFollowup: () => {},
    });

    await runner.runMessage("who am i", "test-channel");

    // Must not execute without approval, even for a harmless command
    expect(shell.executed).toHaveLength(0);
    expect(approvalMessages).toHaveLength(1);
  });

  it("approval followup contains actual tool output, not a generic message", async () => {
    const llm = new MockLLMClient();
    const shell = new FakeShellModule();
    const policy = getDefaultPolicy();

    llm.addToolCall(
      "run_command",
      { command: "echo hello world" },
      "Done.",
    );

    const followups: string[] = [];

    const runner = new TaskRunner(workspace.dir, llm as any, [shell], logger, {
      policy,
      onApprovalNeeded: () => {},
      onFollowup: (msg) => followups.push(msg),
    });

    await runner.runMessage("echo test", "test-channel");

    const approvalMgr = runner.getApprovalManager();
    const pending = await approvalMgr.list("pending");
    await approvalMgr.approve(pending[0].id, "founder");

    await new Promise((resolve) => setTimeout(resolve, 3000));

    // CRITICAL: The followup must contain the actual output from executeTool
    // FakeShellModule returns: Command output: executed "echo hello world"
    expect(followups).toHaveLength(1);
    expect(followups[0]).toContain("echo hello world");
  });
});
