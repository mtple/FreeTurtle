import { describe, it, expect } from "vitest";
import { requiresApproval, parsePolicy, getDefaultPolicy, PolicyDeniedError } from "./policy.js";

describe("requiresApproval", () => {
  it("requires approval for run_command", () => {
    expect(requiresApproval(undefined, "run_command", { command: "ls" })).toBe(true);
  });

  it("requires approval for delete_cast", () => {
    expect(requiresApproval(undefined, "delete_cast", {})).toBe(true);
  });

  it("requires approval for write_file to soul.md", () => {
    expect(
      requiresApproval(undefined, "write_file", { path: "soul.md" }),
    ).toBe(true);
  });

  it("requires approval for edit_file to config.md", () => {
    expect(
      requiresApproval(undefined, "edit_file", { path: "config.md" }),
    ).toBe(true);
  });

  it("requires approval for write_file to .env", () => {
    expect(
      requiresApproval(undefined, "write_file", { path: ".env" }),
    ).toBe(true);
  });

  it("does not require approval for read_file", () => {
    expect(requiresApproval(undefined, "read_file", { path: "soul.md" })).toBe(false);
  });

  it("does not require approval for regular write_file", () => {
    expect(
      requiresApproval(undefined, "write_file", { path: "memory/notes.md" }),
    ).toBe(false);
  });

  it("does not require approval for manage_process", () => {
    expect(
      requiresApproval(undefined, "manage_process", { action: "list" }),
    ).toBe(false);
  });

  it("requires approval for commit_file to main branch", () => {
    expect(
      requiresApproval(undefined, "commit_file", { branch: "main" }),
    ).toBe(true);
  });

  it("does not require approval for commit_file to feature branch with custom policy", () => {
    const policy = getDefaultPolicy();
    policy.github.approval_required_branches = ["main"];
    expect(
      requiresApproval(policy, "commit_file", { branch: "feature/test" }),
    ).toBe(false);
  });
});

describe("parsePolicy", () => {
  it("returns defaults for empty input", () => {
    const policy = parsePolicy({});
    expect(policy.approvals.timeout_seconds).toBe(300);
    expect(policy.approvals.fail_mode).toBe("deny");
    expect(policy.github.approval_required_branches).toEqual(["main"]);
  });

  it("parses comma-separated lists", () => {
    const policy = parsePolicy({
      github: { allowed_repos: "repo1, repo2, repo3" },
    });
    expect(policy.github.allowed_repos).toEqual(["repo1", "repo2", "repo3"]);
  });

  it("parses approval timeout", () => {
    const policy = parsePolicy({
      approvals: { timeout_seconds: "600" },
    });
    expect(policy.approvals.timeout_seconds).toBe(600);
  });
});
