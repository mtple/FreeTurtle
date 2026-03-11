import { loadSkills } from "../skills/index.js";
import { loadConfig } from "../config.js";

export async function runSkillsList(dir: string): Promise<void> {
  const config = await loadConfig(dir);
  const skills = await loadSkills(dir, config.skills);

  if (skills.length === 0) {
    console.log("\n  No skills found.\n");
    console.log("  Install skills with: clawhub install <slug>");
    console.log(`  Or add SKILL.md directories to: ${dir}/skills/\n`);
    return;
  }

  console.log(`\n  \x1b[1m${skills.length} skill(s) loaded\x1b[0m\n`);

  for (const skill of skills) {
    const flags: string[] = [];
    if (!skill.modelInvocable) flags.push("no-auto");
    if (!skill.userInvocable) flags.push("hidden");
    if (skill.allowedTools.length > 0) flags.push(`tools: ${skill.allowedTools.join(", ")}`);

    const flagStr = flags.length > 0 ? ` \x1b[2m(${flags.join(", ")})\x1b[0m` : "";
    console.log(`  \x1b[38;2;94;255;164m${skill.name}\x1b[0m${flagStr}`);
    console.log(`    ${skill.description || "(no description)"}`);
    console.log(`    \x1b[2m${skill.source} — ${skill.dir}\x1b[0m`);
    console.log();
  }
}
