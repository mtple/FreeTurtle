import { readdir, readFile, rm, mkdir, writeFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseSkillMd } from "../modules/clawhub/parser.js";

const execFileAsync = promisify(execFile);

/**
 * Install a skill from the ClawHub registry using `npx clawhub@latest`.
 * Falls back to a direct git clone from the openclaw/skills repo when
 * the clawhub CLI is unavailable.
 */
export async function installSkill(dir: string, slug: string): Promise<void> {
  const skillsDir = join(dir, "skills");
  await mkdir(skillsDir, { recursive: true });

  // Validate slug format
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    console.error(
      `Invalid skill slug "${slug}". Must be lowercase alphanumeric with hyphens.`,
    );
    process.exit(1);
  }

  const targetDir = join(skillsDir, slug);
  try {
    await access(targetDir);
    console.error(`Skill "${slug}" is already installed at ${targetDir}`);
    process.exit(1);
  } catch {
    // Not installed — continue
  }

  console.log(`Installing skill "${slug}" from ClawHub...`);

  // Try npx clawhub first
  try {
    await execFileAsync(
      "npx",
      ["clawhub@latest", "install", slug, "--dir", skillsDir],
      { timeout: 60_000, cwd: dir },
    );
    console.log(`Installed "${slug}" via clawhub CLI.`);
    return;
  } catch {
    // clawhub CLI not available — fall back to direct download
  }

  // Fallback: download SKILL.md from the openclaw/skills GitHub repo
  console.log("clawhub CLI not available, trying direct download...");
  try {
    const url = `https://raw.githubusercontent.com/openclaw/skills/main/skills/${slug}/SKILL.md`;
    const { stdout } = await execFileAsync("curl", ["-fsSL", url], {
      timeout: 30_000,
    });

    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "SKILL.md"), stdout, "utf-8");
    console.log(`Downloaded "${slug}" to ${targetDir}`);
  } catch (err) {
    console.error(
      `Failed to install "${slug}". Make sure the skill exists on ClawHub.`,
    );
    if (err instanceof Error) console.error(err.message);
    process.exit(1);
  }
}

/**
 * List all installed skills.
 */
export async function listSkills(dir: string): Promise<void> {
  const skillsDir = join(dir, "skills");

  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    console.log("No skills directory found. Install skills with:");
    console.log("  freeturtle skills install <slug>");
    return;
  }

  const skills: { name: string; description: string; emoji: string }[] = [];

  for (const entry of entries) {
    const entryPath = join(skillsDir, entry);
    try {
      const info = await stat(entryPath);
      if (!info.isDirectory()) continue;
    } catch {
      continue;
    }

    // Try to find SKILL.md
    for (const fname of ["SKILL.md", "skill.md"]) {
      const skillFile = join(entryPath, fname);
      try {
        const raw = await readFile(skillFile, "utf-8");
        const parsed = parseSkillMd(raw, entryPath);
        skills.push({
          name: parsed.meta.name || entry,
          description: parsed.meta.description || "(no description)",
          emoji: parsed.meta.emoji ?? "",
        });
        break;
      } catch {
        // try next
      }
    }
  }

  if (skills.length === 0) {
    console.log("No skills installed. Install skills with:");
    console.log("  freeturtle skills install <slug>");
    return;
  }

  console.log(`\nInstalled ClawHub skills (${skills.length}):\n`);
  for (const s of skills) {
    const emoji = s.emoji ? `${s.emoji} ` : "";
    console.log(`  ${emoji}${s.name} — ${s.description}`);
  }
  console.log(
    "\nEnable the clawhub module in config.md to use these skills:\n" +
      "  ### clawhub\n" +
      "  - enabled: true\n",
  );
}

/**
 * Remove an installed skill.
 */
export async function removeSkill(dir: string, name: string): Promise<void> {
  const skillDir = join(dir, "skills", name);
  try {
    await access(skillDir);
  } catch {
    console.error(`Skill "${name}" is not installed.`);
    process.exit(1);
  }

  await rm(skillDir, { recursive: true, force: true });
  console.log(`Removed skill "${name}".`);
}
