// Policy types
// undefined = no restriction (allow all), [] = deny all, [...values] = only allow listed
export interface PolicyConfig {
  github: {
    allowed_repos?: string[];
    allowed_paths?: string[];
    approval_required_branches: string[]; // default: ["main"]
  };
  farcaster: {
    allowed_channels?: string[];
  };
  database: {
    allowed_schemas?: string[];
    allowed_tables?: string[];
  };
  onchain: {
    allowed_contracts?: string[];
    allowed_read_functions?: string[];
  };
  approvals: {
    timeout_seconds: number; // default: 300
    fail_mode: "deny" | "allow"; // default: "deny"
  };
}

// Empty allowlist = deny all for that domain
// undefined/not set = allow all (no restriction)

export class PolicyDeniedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PolicyDeniedError";
    this.code = code;
  }
}

/**
 * Core allowlist check:
 * - undefined = no restrictions (allow all)
 * - empty array [] = deny everything
 * - populated array = only allow listed values (case-insensitive)
 */
function assertAllowed(
  allowlist: string[] | undefined,
  value: string,
  code: string,
  label: string,
): void {
  if (allowlist === undefined) return; // not configured = allow all
  if (allowlist.length === 0) {
    throw new PolicyDeniedError(code, `${label} denied: no entries are allowed (empty allowlist)`);
  }
  const lower = value.toLowerCase();
  const match = allowlist.some((item) => item.toLowerCase() === lower);
  if (!match) {
    throw new PolicyDeniedError(
      code,
      `${label} denied: "${value}" is not in the allowlist [${allowlist.join(", ")}]`,
    );
  }
}

export function assertGithubRepoAllowed(
  policy: PolicyConfig | undefined,
  repo: string,
): void {
  if (!policy) return;
  assertAllowed(policy.github?.allowed_repos, repo, "GITHUB_REPO_DENIED", "GitHub repo");
}

export function assertGithubPathAllowed(
  policy: PolicyConfig | undefined,
  path: string,
): void {
  if (!policy) return;
  assertAllowed(policy.github?.allowed_paths, path, "GITHUB_PATH_DENIED", "GitHub path");
}

export function assertGithubBranchAllowed(
  policy: PolicyConfig | undefined,
  branch: string,
): void {
  if (!policy) return;
  assertAllowed(
    policy.github?.approval_required_branches,
    branch,
    "GITHUB_BRANCH_DENIED",
    "GitHub branch",
  );
}

export function assertFarcasterChannelAllowed(
  policy: PolicyConfig | undefined,
  channel: string,
): void {
  if (!policy) return;
  assertAllowed(
    policy.farcaster?.allowed_channels,
    channel,
    "FARCASTER_CHANNEL_DENIED",
    "Farcaster channel",
  );
}

export function assertDatabaseScopeAllowed(
  policy: PolicyConfig | undefined,
  schema: string,
  table: string,
): void {
  if (!policy) return;
  assertAllowed(
    policy.database?.allowed_schemas,
    schema,
    "DATABASE_SCHEMA_DENIED",
    "Database schema",
  );
  assertAllowed(
    policy.database?.allowed_tables,
    table,
    "DATABASE_TABLE_DENIED",
    "Database table",
  );
}

export function assertOnchainScopeAllowed(
  policy: PolicyConfig | undefined,
  contract: string,
  fn?: string,
): void {
  if (!policy) return;
  assertAllowed(
    policy.onchain?.allowed_contracts,
    contract,
    "ONCHAIN_CONTRACT_DENIED",
    "Onchain contract",
  );
  if (fn !== undefined) {
    assertAllowed(
      policy.onchain?.allowed_read_functions,
      fn,
      "ONCHAIN_FUNCTION_DENIED",
      "Onchain function",
    );
  }
}

/** Files that require founder approval to modify */
const PROTECTED_WORKSPACE_FILES = ["soul.md", "config.md", ".env"];

/**
 * Determines whether a tool call requires human approval before execution.
 * - delete_cast => always true
 * - commit_file => true if branch is in approval_required_branches (default ["main"])
 * - write_file / edit_file => true if path is a protected file (soul.md, config.md, .env)
 * - everything else => false
 */
export function requiresApproval(
  policy: PolicyConfig | undefined,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  if (toolName === "delete_cast") return true;

  if (toolName === "commit_file") {
    const branch = (input.branch as string) ?? "main";
    const approvalBranches =
      policy?.github?.approval_required_branches ?? ["main"];
    return approvalBranches.some(
      (b) => b.toLowerCase() === branch.toLowerCase(),
    );
  }

  if (toolName === "write_file" || toolName === "edit_file") {
    const path = (input.path as string) ?? "";
    return PROTECTED_WORKSPACE_FILES.some(
      (f) => path === f || path.endsWith(`/${f}`),
    );
  }

  return false;
}

export function getDefaultPolicy(): PolicyConfig {
  // Default: permissive. undefined = allow all (no restriction).
  // Users opt into restrictions by adding a ## Policy section to config.md.
  return {
    github: {
      approval_required_branches: ["main"],
    },
    farcaster: {},
    database: {},
    onchain: {},
    approvals: {
      timeout_seconds: 300,
      fail_mode: "deny",
    },
  };
}

/**
 * Parse a raw config object (from the ## Policy section) into a PolicyConfig.
 * Expects subsections like github.allowed_repos as comma-separated strings.
 */
export function parsePolicy(
  raw: Record<string, Record<string, string | boolean>>,
): PolicyConfig {
  const defaults = getDefaultPolicy();

  function parseList(value: string | boolean | undefined): string[] | undefined {
    if (value === undefined) return undefined;
    if (typeof value === "boolean") return [];
    const trimmed = value.trim();
    if (trimmed === "") return [];
    return trimmed.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }

  function parseString(
    value: string | boolean | undefined,
    fallback: string,
  ): string {
    if (value === undefined || typeof value === "boolean") return fallback;
    return value.trim() || fallback;
  }

  function parseNumber(
    value: string | boolean | undefined,
    fallback: number,
  ): number {
    if (value === undefined || typeof value === "boolean") return fallback;
    const n = Number(value);
    return Number.isNaN(n) ? fallback : n;
  }

  const github = raw.github ?? {};
  const farcaster = raw.farcaster ?? {};
  const database = raw.database ?? {};
  const onchain = raw.onchain ?? {};
  const approvals = raw.approvals ?? {};

  return {
    github: {
      allowed_repos:
        parseList(github.allowed_repos) ?? defaults.github.allowed_repos,
      allowed_paths:
        parseList(github.allowed_paths) ?? defaults.github.allowed_paths,
      approval_required_branches:
        parseList(github.approval_required_branches) ??
        defaults.github.approval_required_branches,
    },
    farcaster: {
      allowed_channels:
        parseList(farcaster.allowed_channels) ??
        defaults.farcaster.allowed_channels,
    },
    database: {
      allowed_schemas:
        parseList(database.allowed_schemas) ??
        defaults.database.allowed_schemas,
      allowed_tables:
        parseList(database.allowed_tables) ??
        defaults.database.allowed_tables,
    },
    onchain: {
      allowed_contracts:
        parseList(onchain.allowed_contracts) ??
        defaults.onchain.allowed_contracts,
      allowed_read_functions:
        parseList(onchain.allowed_read_functions) ??
        defaults.onchain.allowed_read_functions,
    },
    approvals: {
      timeout_seconds: parseNumber(
        approvals.timeout_seconds,
        defaults.approvals.timeout_seconds,
      ),
      fail_mode:
        (parseString(approvals.fail_mode, defaults.approvals.fail_mode) as
          | "deny"
          | "allow"),
    },
  };
}
