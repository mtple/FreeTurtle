/**
 * SKILL.md frontmatter parser.
 * Parses YAML frontmatter between --- markers without external dependencies.
 */

import type { SkillFrontmatter } from "./types.js";

/**
 * Parse a SKILL.md file into frontmatter + body.
 * Returns null if the file doesn't have valid frontmatter.
 */
export function parseSkillMd(raw: string): { frontmatter: SkillFrontmatter; body: string } | null {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) return null;

  const secondFence = trimmed.indexOf("---", 3);
  if (secondFence === -1) return null;

  const yamlBlock = trimmed.slice(3, secondFence).trim();
  const body = trimmed.slice(secondFence + 3).trim();

  const frontmatter = parseSimpleYaml(yamlBlock);
  if (!frontmatter.name && !frontmatter.description) return null;

  return { frontmatter: frontmatter as unknown as SkillFrontmatter, body };
}

/**
 * Minimal YAML parser for flat key-value frontmatter.
 * Handles strings, booleans, and simple nested metadata maps.
 * Does NOT handle arrays, multi-line values, or complex YAML.
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentMap: Record<string, string> | null = null;

  for (const line of yaml.split("\n")) {
    // Blank line
    if (line.trim() === "") continue;

    // Check indentation — if indented and we're in a map, it's a nested value
    const indent = line.length - line.trimStart().length;
    if (indent > 0 && currentMap !== null && currentKey !== null) {
      const kvMatch = line.trim().match(/^([a-zA-Z0-9_.-]+):\s*(.*)/);
      if (kvMatch) {
        currentMap[kvMatch[1]] = unquote(kvMatch[2].trim());
      }
      continue;
    }

    // Close any open map
    if (currentMap !== null && currentKey !== null) {
      result[currentKey] = currentMap;
      currentMap = null;
      currentKey = null;
    }

    // Top-level key: value
    const kvMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();

    // Empty value — could be a map start
    if (rawValue === "") {
      currentKey = key;
      currentMap = {};
      continue;
    }

    result[key] = parseValue(rawValue);
  }

  // Close trailing map
  if (currentMap !== null && currentKey !== null) {
    result[currentKey] = currentMap;
  }

  return result;
}

function parseValue(raw: string): string | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return unquote(raw);
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
