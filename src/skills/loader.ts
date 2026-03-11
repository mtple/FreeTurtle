/**
 * Skill loader — discovers and loads Agent Skills from the filesystem.
 *
 * Follows the same progressive disclosure model as OpenClaw:
 *   - Only name/description/location are injected into the system prompt
 *   - Full SKILL.md body is loaded on-demand via the read_file tool
 *   - XML format for the available_skills block
 *
 * Scan order (highest to lowest precedence):
 *   1. Workspace skills:  <workspace>/skills/
 *   2. Managed skills:    ~/.freeturtle/skills/  (shared across agents)
 *   3. Extra dirs:        Configured via skills.extra_dirs in config.md
 *
 * Compatible with OpenClaw, Claude Code, and ClawHub-installed skills.
 * Skills installed via `clawhub install` into <workspace>/skills/ are picked up automatically.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { parseSkillMd } from "./parser.js";
import type { LoadedSkill, SkillsConfig } from "./types.js";
import type { Logger } from "../logger.js";

const SKILL_FILENAME = "SKILL.md";

// Limits aligned with OpenClaw defaults
const MAX_SKILLS_IN_PROMPT = 150;
const MAX_PROMPT_CHARS = 30_000;
const MAX_SKILL_FILE_BYTES = 256 * 1024; // 256 KB
const MAX_SKILLS_PER_SOURCE = 200;

export async function loadSkills(
  workspaceDir: string,
  config?: SkillsConfig,
  logger?: Logger,
): Promise<LoadedSkill[]> {
  if (config && !config.enabled) {
    logger?.info("Skills disabled in config");
    return [];
  }

  const skills: LoadedSkill[] = [];
  const seenNames = new Set<string>();

  // 1. Workspace skills (highest precedence)
  const workspaceSkillsDir = join(workspaceDir, "skills");
  await scanSkillDir(workspaceSkillsDir, "workspace", skills, seenNames, logger);

  // 2. Managed skills (shared across agents)
  const managedDir = join(homedir(), ".freeturtle", "skills");
  if (managedDir !== workspaceSkillsDir) {
    await scanSkillDir(managedDir, "managed", skills, seenNames, logger);
  }

  // 3. Extra directories from config
  if (config?.extra_dirs) {
    for (const dir of config.extra_dirs) {
      await scanSkillDir(dir, "extra", skills, seenNames, logger);
    }
  }

  if (skills.length > 0) {
    logger?.info(`Loaded ${skills.length} skill(s): ${skills.map((s) => s.name).join(", ")}`);
  }

  return skills;
}

async function scanSkillDir(
  dir: string,
  source: LoadedSkill["source"],
  skills: LoadedSkill[],
  seenNames: Set<string>,
  logger?: Logger,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // Directory doesn't exist — that's fine
    return;
  }

  let loadedFromSource = 0;

  for (const entry of entries) {
    if (loadedFromSource >= MAX_SKILLS_PER_SOURCE) {
      logger?.warn(`Hit max skills per source (${MAX_SKILLS_PER_SOURCE}) for ${dir}`);
      break;
    }

    const skillDir = join(dir, entry);

    // Must be a directory
    try {
      const s = await stat(skillDir);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }

    // Must contain SKILL.md
    const skillMdPath = join(skillDir, SKILL_FILENAME);
    let raw: string;
    try {
      const s = await stat(skillMdPath);
      if (s.size > MAX_SKILL_FILE_BYTES) {
        logger?.warn(`SKILL.md in ${skillDir} exceeds ${MAX_SKILL_FILE_BYTES / 1024}KB — skipping`);
        continue;
      }
      raw = await readFile(skillMdPath, "utf-8");
    } catch {
      continue;
    }

    // Parse the SKILL.md
    const parsed = parseSkillMd(raw);
    if (!parsed) {
      logger?.warn(`Invalid SKILL.md in ${skillDir} — skipping`);
      continue;
    }

    // Skill name: frontmatter.name or directory name
    const name = parsed.frontmatter.name || basename(skillDir);

    // Validate name format (Agent Skills spec: lowercase alphanumeric + hyphens)
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name)) {
      logger?.warn(`Skill "${name}" has invalid name format — skipping`);
      continue;
    }

    // Higher-precedence skills shadow lower ones
    if (seenNames.has(name)) {
      logger?.info(`Skill "${name}" from ${source} shadowed by higher-precedence source`);
      continue;
    }
    seenNames.add(name);

    const allowedToolsRaw = parsed.frontmatter["allowed-tools"];
    const allowedTools = allowedToolsRaw
      ? allowedToolsRaw.split(/\s+/).filter((t) => t.length > 0)
      : [];

    skills.push({
      name,
      description: parsed.frontmatter.description || "",
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      dir: skillDir,
      source,
      modelInvocable: parsed.frontmatter["disable-model-invocation"] !== true,
      userInvocable: parsed.frontmatter["user-invocable"] !== false,
      allowedTools,
    });

    loadedFromSource++;
  }
}

/**
 * Compact a file path by replacing the home directory with ~.
 * Saves tokens in the system prompt (same as OpenClaw).
 */
function compactPath(p: string): string {
  const home = homedir();
  if (p.startsWith(home)) {
    return "~" + p.slice(home.length);
  }
  return p;
}

/**
 * Build the skills section for the system prompt.
 *
 * Uses the same progressive disclosure model as OpenClaw:
 * - Only name/description/location are injected (not the full body)
 * - The LLM reads the full SKILL.md via read_file when a skill matches
 * - XML format for the available_skills block
 * - Token budget enforcement via character limits
 */
export function buildSkillsPrompt(skills: LoadedSkill[]): string {
  const eligible = skills.filter((s) => s.modelInvocable);
  if (eligible.length === 0) return "";

  // Apply limits: max skills in prompt
  const capped = eligible.slice(0, MAX_SKILLS_IN_PROMPT);

  const header = [
    "## Skills (mandatory)",
    "",
    "Before replying, scan the <available_skills> descriptions below.",
    "- If exactly one skill clearly applies: read its SKILL.md at the given location with `read_file`, then follow its instructions.",
    "- If multiple could apply: choose the most specific one, then read and follow it.",
    "- If none clearly apply: do not read any SKILL.md.",
    "- Never read more than one skill up front; only read after selecting.",
    "- When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md).",
    "",
  ].join("\n");

  // Build XML block, enforcing character budget
  const xmlOpen = "<available_skills>\n";
  const xmlClose = "</available_skills>";

  let promptChars = header.length + xmlOpen.length + xmlClose.length;
  const skillEntries: string[] = [];

  for (const skill of capped) {
    const location = compactPath(join(skill.dir, SKILL_FILENAME));
    const entry = [
      "  <skill>",
      `    <name>${escapeXml(skill.name)}</name>`,
      `    <description>${escapeXml(skill.description)}</description>`,
      `    <location>${escapeXml(location)}</location>`,
      "  </skill>",
    ].join("\n");

    if (promptChars + entry.length + 1 > MAX_PROMPT_CHARS) {
      break;
    }

    skillEntries.push(entry);
    promptChars += entry.length + 1; // +1 for newline
  }

  if (skillEntries.length === 0) return "";

  return header + xmlOpen + skillEntries.join("\n") + "\n" + xmlClose;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- Deprecated, kept for backward compat ---

/** @deprecated Use buildSkillsPrompt instead */
export function buildSkillIndex(skills: LoadedSkill[]): string {
  return buildSkillsPrompt(skills);
}

/** @deprecated Skills are now loaded on-demand via read_file */
export function getSkillPrompt(skill: LoadedSkill): string {
  const parts = [`## Skill: ${skill.name}`, ""];
  if (skill.frontmatter.compatibility) {
    parts.push(`Compatibility: ${skill.frontmatter.compatibility}`, "");
  }
  parts.push(skill.body);
  return parts.join("\n");
}
