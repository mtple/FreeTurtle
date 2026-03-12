import { describe, it, expect } from "vitest";
import { requiresApproval, parsePolicy, getDefaultPolicy, PolicyDeniedError, isCoreSection } from "./policy.js";

describe("requiresApproval", () => {
  it("does not require approval for run_command", () => {
    expect(requiresApproval(undefined, "run_command", { command: "ls" })).toBe(false);
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

const SAMPLE_SOUL = `# TestCEO — Soul

<!-- CORE -->
## Identity

TestCEO is the AI CEO of TestProject. It builds things.

The founder is Alice. TestCEO is openly AI.

---
<!-- /CORE -->

<!-- MUTABLE -->
## Voice

Sharp and dry — says more with less.

**Tone markers:**
- Keep posts concise
- No generic AI-speak

---
<!-- /MUTABLE -->

<!-- CORE -->
## Values & Boundaries

**Do:**
- Have opinions
- Be honest

**Do not:**
- Pretend to be human
- Overhype
<!-- /CORE -->

---

<!-- MUTABLE -->
## Continuity

You wake up fresh each session.
<!-- /MUTABLE -->
`;

describe("isCoreSection", () => {
  it("identifies text inside a CORE block", () => {
    expect(isCoreSection(SAMPLE_SOUL, "TestCEO is the AI CEO of TestProject")).toBe(true);
  });

  it("identifies text inside a second CORE block", () => {
    expect(isCoreSection(SAMPLE_SOUL, "Pretend to be human")).toBe(true);
  });

  it("returns false for MUTABLE content", () => {
    expect(isCoreSection(SAMPLE_SOUL, "Sharp and dry")).toBe(false);
  });

  it("returns false for MUTABLE Continuity content", () => {
    expect(isCoreSection(SAMPLE_SOUL, "You wake up fresh each session")).toBe(false);
  });

  it("returns false for text not in any block", () => {
    expect(isCoreSection(SAMPLE_SOUL, "this text does not exist anywhere")).toBe(false);
  });

  it("returns false when there are no CORE blocks", () => {
    const noCoreFile = "## Identity\n\nJust some text.\n";
    expect(isCoreSection(noCoreFile, "Just some text")).toBe(false);
  });

  it("handles text at the boundary of a CORE block", () => {
    // The CORE tag itself is not inside the captured group
    expect(isCoreSection(SAMPLE_SOUL, "## Identity")).toBe(true);
    expect(isCoreSection(SAMPLE_SOUL, "## Values & Boundaries")).toBe(true);
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
