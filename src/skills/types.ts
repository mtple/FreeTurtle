/**
 * Agent Skills specification types.
 * Compatible with OpenClaw, Claude Code, Codex, and ClawHub.
 * Spec: https://agentskills.io/specification
 */

export interface SkillFrontmatter {
  /** 1-64 chars, lowercase alphanumeric + hyphens, must match directory name */
  name: string;
  /** 1-1024 chars, describes what skill does and when to use it */
  description: string;
  /** License name or reference to bundled file */
  license?: string;
  /** Max 500 chars, environment requirements */
  compatibility?: string;
  /** Arbitrary key-value metadata (string to string) */
  metadata?: Record<string, string>;
  /** Space-delimited list of pre-approved tools */
  "allowed-tools"?: string;

  // --- OpenClaw extensions ---
  /** Expose as slash command (default: true) */
  "user-invocable"?: boolean;
  /** Prevent auto-invocation by LLM (default: false) */
  "disable-model-invocation"?: boolean;

  // --- Claude Code extensions (safely ignored if unsupported) ---
  "argument-hint"?: string;
  model?: string;
  context?: string;
  agent?: string;
}

export interface LoadedSkill {
  /** Skill name (from frontmatter or directory name) */
  name: string;
  /** Short description for metadata-level loading */
  description: string;
  /** Full SKILL.md body (markdown after frontmatter) */
  body: string;
  /** Parsed frontmatter */
  frontmatter: SkillFrontmatter;
  /** Absolute path to skill directory */
  dir: string;
  /** Where the skill was loaded from */
  source: "workspace" | "managed" | "bundled" | "extra";
  /** Whether the LLM can auto-invoke this skill */
  modelInvocable: boolean;
  /** Whether the user can invoke as a slash command */
  userInvocable: boolean;
  /** Pre-approved tool names */
  allowedTools: string[];
}

export interface SkillsConfig {
  enabled: boolean;
  /** Additional directories to scan for skills */
  extra_dirs?: string[];
}
