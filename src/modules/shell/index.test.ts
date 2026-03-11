import { describe, it, expect } from "vitest";
import { ShellModule } from "./index.js";

describe("ShellModule", () => {
  const mod = new ShellModule();

  it("registers run_command and manage_process tools", () => {
    const tools = mod.getTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("run_command");
    expect(names).toContain("manage_process");
  });

  it("executes a simple command", async () => {
    await mod.initialize({}, {});
    const result = await mod.executeTool("run_command", {
      command: "echo hello",
    });
    expect(result).toBe("hello");
  });

  it("returns stderr", async () => {
    const result = await mod.executeTool("run_command", {
      command: "echo oops >&2",
    });
    expect(result).toContain("STDERR:");
    expect(result).toContain("oops");
  });

  it("returns exit code on failure", async () => {
    const result = await mod.executeTool("run_command", {
      command: "exit 42",
    });
    expect(result).toContain("Exit code: 42");
  });

  it("respects working_directory", async () => {
    const result = await mod.executeTool("run_command", {
      command: "pwd",
      working_directory: "/tmp",
    });
    // macOS resolves /tmp -> /private/tmp
    expect(result).toMatch(/\/tmp/);
  });

  it("blocks dangerous env vars", async () => {
    const result = await mod.executeTool("run_command", {
      command: "echo $PATH",
      env: { PATH: "/evil", MY_VAR: "safe" },
    });
    // PATH override should be blocked, so $PATH should be the system PATH
    expect(result).not.toContain("/evil");
  });

  it("runs background commands and lists sessions", async () => {
    await mod.executeTool("run_command", {
      command: "sleep 0.1 && echo done",
      background: true,
    });

    const list = await mod.executeTool("manage_process", {
      action: "list",
    });
    expect(list).toContain("session_id");
  });

  it("returns error for unknown tool", async () => {
    await expect(
      mod.executeTool("nonexistent", {}),
    ).rejects.toThrow("Unknown tool");
  });

  it("returns error for missing command", async () => {
    const result = await mod.executeTool("run_command", {});
    expect(result).toContain("Error");
  });
});
