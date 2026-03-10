import { readFile, readdir, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FreeTurtleModule, ToolDefinition } from "../types.js";
import type { PolicyConfig } from "../../policy.js";
import { clawHubTools } from "./tools.js";
import { parseSkillMd, type ParsedSkill } from "./parser.js";

const execFileAsync = promisify(execFile);

/** Binaries that are never allowed regardless of skill declarations. */
const BLOCKED_BINS = new Set([
  "rm",
  "rmdir",
  "mkfs",
  "dd",
  "shutdown",
  "reboot",
  "passwd",
  "su",
  "sudo",
  "chown",
  "chmod",
  "kill",
  "killall",
]);

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 256 * 1024; // 256 KB

export class ClawHubModule implements FreeTurtleModule {
  name = "clawhub";
  description =
    "Load and run OpenClaw / ClawHub skills — community-built AI agent capabilities.";

  private skills = new Map<string, ParsedSkill>();
  private workspaceDir!: string;
  private skillsDirs: string[] = [];

  async initialize(
    config: Record<string, unknown>,
    env: Record<string, string>,
    _options?: { policy?: PolicyConfig }, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<void> {
    this.workspaceDir = (config._workspaceDir as string) ?? "";
    if (!this.workspaceDir) {
      throw new Error("ClawHub module requires _workspaceDir");
    }

    // Skill search order mirrors OpenClaw precedence:
    // 1. <workspace>/skills  (highest)
    // 2. ~/.freeturtle/skills (managed/local — same as workspace for FreeTurtle)
    // 3. Custom dirs from config
    const workspaceSkills = join(this.workspaceDir, "skills");
    this.skillsDirs = [workspaceSkills];

    if (config.extra_dirs) {
      const extra = String(config.extra_dirs)
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);
      this.skillsDirs.push(...extra);
    }

    await this.discoverSkills(env);
  }

  getTools(): ToolDefinition[] {
    return clawHubTools;
  }

  /** Return a read-only view of loaded skills for system-prompt injection. */
  getLoadedSkills(): ParsedSkill[] {
    return Array.from(this.skills.values());
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    switch (name) {
      case "list_skills":
        return this.listSkills();
      case "read_skill_instructions":
        return this.readSkillInstructions(input.skill_name as string);
      case "run_skill_command":
        return this.runSkillCommand(
          input.skill_name as string,
          input.command as string,
          input.timeout_ms as number | undefined,
        );
      default:
        throw new Error(`Unknown clawhub tool: ${name}`);
    }
  }

  // -----------------------------------------------------------------------
  // Skill discovery
  // -----------------------------------------------------------------------

  private async discoverSkills(env: Record<string, string>): Promise<void> {
    for (const dir of this.skillsDirs) {
      try {
        await access(dir);
      } catch {
        continue; // directory doesn't exist — skip
      }

      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const skillDir = join(dir, entry);
        try {
          const info = await stat(skillDir);
          if (!info.isDirectory()) continue;
        } catch {
          continue;
        }

        const skillFile = await this.findSkillFile(skillDir);
        if (!skillFile) continue;

        try {
          const raw = await readFile(skillFile, "utf-8");
          const parsed = parseSkillMd(raw, skillDir);

          // Gate: check requirements
          if (!this.meetsRequirements(parsed, env)) continue;

          // Gate: OS check
          if (parsed.meta.os && parsed.meta.os.length > 0) {
            const platform =
              process.platform === "darwin"
                ? "darwin"
                : process.platform === "win32"
                  ? "windows"
                  : "linux";
            if (!parsed.meta.os.includes(platform)) continue;
          }

          // Gate: disable-model-invocation skills are skipped
          if (parsed.meta.disableModelInvocation) continue;

          // Higher-precedence directory wins on name collision
          if (!this.skills.has(parsed.meta.name)) {
            this.skills.set(parsed.meta.name, parsed);
          }
        } catch {
          // Malformed skill — skip silently
        }
      }
    }
  }

  private async findSkillFile(dir: string): Promise<string | null> {
    for (const name of ["SKILL.md", "skill.md"]) {
      const p = join(dir, name);
      try {
        await access(p);
        return p;
      } catch {
        // not found
      }
    }
    return null;
  }

  private meetsRequirements(
    skill: ParsedSkill,
    env: Record<string, string>,
  ): boolean {
    const req = skill.meta.requires;
    if (!req) return true;

    // Check env vars
    if (req.env) {
      for (const v of req.env) {
        if (!env[v] && !process.env[v]) return false;
      }
    }

    // Binary checks are deferred to runtime (run_skill_command validates)
    return true;
  }

  // -----------------------------------------------------------------------
  // Tool implementations
  // -----------------------------------------------------------------------

  private listSkills(): string {
    if (this.skills.size === 0) {
      return "No ClawHub skills are installed.\n\nTo add skills, place OpenClaw-compatible skill directories in your workspace's skills/ folder (~/.freeturtle/skills/<skill-name>/SKILL.md).";
    }

    const lines: string[] = ["Installed ClawHub skills:\n"];
    for (const skill of this.skills.values()) {
      const emoji = skill.meta.emoji ? `${skill.meta.emoji} ` : "";
      const version = skill.meta.version ? ` (v${skill.meta.version})` : "";
      lines.push(`- ${emoji}${skill.meta.name}${version}: ${skill.meta.description}`);
    }
    lines.push(
      `\n${this.skills.size} skill(s) loaded. Use read_skill_instructions to see a skill's full instructions.`,
    );
    return lines.join("\n");
  }

  private readSkillInstructions(skillName: string): string {
    const skill = this.skills.get(skillName);
    if (!skill) {
      const available = Array.from(this.skills.keys()).join(", ");
      return `Error: Skill "${skillName}" not found. Available: ${available || "(none)"}`;
    }

    const header = [
      `# ${skill.meta.emoji ?? ""} ${skill.meta.name}`,
      skill.meta.description,
      skill.meta.version ? `Version: ${skill.meta.version}` : "",
      skill.meta.homepage ? `Homepage: ${skill.meta.homepage}` : "",
      "",
      "---",
      "",
    ]
      .filter(Boolean)
      .join("\n");

    return header + skill.instructions;
  }

  private async runSkillCommand(
    skillName: string,
    command: string,
    timeoutMs?: number,
  ): Promise<string> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return `Error: Skill "${skillName}" not found.`;
    }

    // Parse the command to extract the binary
    const parts = command.trim().split(/\s+/);
    const bin = parts[0];
    if (!bin) return "Error: Empty command.";

    // Security: block dangerous binaries
    if (BLOCKED_BINS.has(bin)) {
      return `Error: Binary "${bin}" is blocked for security reasons.`;
    }

    // Security: command must only use binaries declared by the skill
    const declaredBins = [
      ...(skill.meta.requires?.bins ?? []),
      ...(skill.meta.requires?.anyBins ?? []),
    ];

    // Allow a small set of universally-safe binaries even if not declared
    const universallyAllowed = new Set([
      "echo",
      "cat",
      "head",
      "tail",
      "wc",
      "sort",
      "uniq",
      "grep",
      "sed",
      "awk",
      "jq",
      "tr",
      "cut",
      "date",
      "env",
      "printf",
      "test",
      "true",
      "false",
      "basename",
      "dirname",
      "pwd",
      "ls",
      "find",
      "xargs",
      "tee",
      "curl",
      "wget",
    ]);

    if (declaredBins.length > 0 && !declaredBins.includes(bin) && !universallyAllowed.has(bin)) {
      return `Error: Binary "${bin}" is not declared by skill "${skillName}". Allowed: ${declaredBins.join(", ")}`;
    }

    // Clamp timeout
    const timeout = Math.min(
      Math.max(timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000),
      MAX_TIMEOUT_MS,
    );

    try {
      const { stdout, stderr } = await execFileAsync("sh", ["-c", command], {
        cwd: this.workspaceDir,
        timeout,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: { ...process.env, HOME: process.env.HOME ?? "" },
      });

      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += (output ? "\n--- stderr ---\n" : "") + stderr;
      return output || "(no output)";
    } catch (err: unknown) {
      if (err instanceof Error) {
        const execErr = err as Error & { killed?: boolean; code?: number; stdout?: string; stderr?: string };
        if (execErr.killed) {
          return `Error: Command timed out after ${timeout}ms.`;
        }
        let msg = `Error (exit ${execErr.code ?? "?"}): ${err.message}`;
        if (execErr.stderr) msg += `\n${execErr.stderr}`;
        if (execErr.stdout) msg += `\n${execErr.stdout}`;
        return msg.slice(0, 4096);
      }
      return `Error: ${String(err)}`;
    }
  }
}
