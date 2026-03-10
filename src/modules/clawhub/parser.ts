/**
 * Parser for OpenClaw SKILL.md files.
 *
 * Each skill is a directory containing a SKILL.md (or skill.md) with optional
 * YAML frontmatter and a Markdown body that serves as the agent instructions.
 */

export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  homepage?: string;
  /** Whether the skill appears as a slash-command (default true). */
  userInvocable?: boolean;
  /** When true the skill is excluded from the model prompt. */
  disableModelInvocation?: boolean;

  requires?: {
    /** Environment variables the skill expects. */
    env?: string[];
    /** CLI binaries that must all be on PATH. */
    bins?: string[];
    /** At least one of these binaries must exist. */
    anyBins?: string[];
  };
  /** The primary credential env var. */
  primaryEnv?: string;
  /** Display emoji. */
  emoji?: string;
  /** OS restrictions (e.g. ["darwin", "linux"]). */
  os?: string[];
}

export interface ParsedSkill {
  /** Resolved metadata from frontmatter. */
  meta: SkillMetadata;
  /** The Markdown body — agent instructions. */
  instructions: string;
  /** Absolute path to the skill directory. */
  dir: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse a SKILL.md string into metadata + instructions.
 *
 * Supports YAML frontmatter delimited by `---`.  The parser is intentionally
 * lenient — it handles the single-line key format used by the OpenClaw
 * registry parser as well as nested `metadata.openclaw` blocks.
 */
export function parseSkillMd(
  raw: string,
  skillDir: string,
): ParsedSkill {
  let meta: SkillMetadata = { name: "", description: "" };
  let instructions = raw;

  // Check for YAML frontmatter
  if (raw.startsWith("---")) {
    const endIdx = raw.indexOf("\n---", 3);
    if (endIdx !== -1) {
      const frontmatter = raw.slice(4, endIdx).trim();
      meta = parseFrontmatter(frontmatter);
      instructions = raw.slice(endIdx + 4).trim();
    }
  }

  // Derive name from directory if not in frontmatter
  if (!meta.name) {
    const parts = skillDir.replace(/\/$/, "").split("/");
    meta.name = parts[parts.length - 1];
  }

  // Replace {baseDir} placeholder used by some skills
  instructions = instructions.replaceAll("{baseDir}", skillDir);

  return { meta, instructions, dir: skillDir };
}

/**
 * Minimal YAML-like parser for frontmatter.  We avoid pulling in a full YAML
 * library to keep the dependency footprint small.  Handles the flat key-value
 * format that ClawHub mandates plus a `metadata` block that may carry JSON.
 */
function parseFrontmatter(text: string): SkillMetadata {
  const meta: SkillMetadata = { name: "", description: "" };
  const lines = text.split("\n");

  for (const line of lines) {
    const kv = line.match(/^(\S+):\s*(.*)/);
    if (!kv) continue;

    const key = kv[1].trim();
    const value = kv[2].trim();

    switch (key) {
      case "name":
        meta.name = stripQuotes(value);
        break;
      case "description":
        meta.description = stripQuotes(value);
        break;
      case "version":
        meta.version = stripQuotes(value);
        break;
      case "homepage":
        meta.homepage = stripQuotes(value);
        break;
      case "user-invocable":
        meta.userInvocable = value === "true";
        break;
      case "disable-model-invocation":
        meta.disableModelInvocation = value === "true";
        break;
      case "metadata": {
        // May be inline JSON: metadata: {"openclaw": {...}}
        try {
          const parsed = JSON.parse(value) as Record<string, unknown>;
          applyMetadataBlock(meta, parsed);
        } catch {
          // Not JSON — ignore
        }
        break;
      }
    }
  }

  return meta;
}

function applyMetadataBlock(
  meta: SkillMetadata,
  raw: Record<string, unknown>,
): void {
  // Accept openclaw, clawdbot, or clawdis keys (all aliases)
  const block =
    (raw.openclaw as Record<string, unknown>) ??
    (raw.clawdbot as Record<string, unknown>) ??
    (raw.clawdis as Record<string, unknown>);
  if (!block) return;

  if (block.emoji) meta.emoji = String(block.emoji);
  if (block.homepage) meta.homepage = String(block.homepage);
  if (block.primaryEnv) meta.primaryEnv = String(block.primaryEnv);

  if (Array.isArray(block.os)) {
    meta.os = block.os.map(String);
  }

  const requires = block.requires as Record<string, unknown> | undefined;
  if (requires) {
    meta.requires = {};
    if (Array.isArray(requires.env)) {
      meta.requires.env = requires.env.map(String);
    }
    if (Array.isArray(requires.bins)) {
      meta.requires.bins = requires.bins.map(String);
    }
    if (Array.isArray(requires.anyBins)) {
      meta.requires.anyBins = requires.anyBins.map(String);
    }
  }
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
