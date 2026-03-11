import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Enable a module in config.md. If the module section exists, sets enabled to true.
 * If it doesn't exist, appends it under ## Modules.
 */
export async function enableModule(dir: string, moduleName: string): Promise<void> {
  const configPath = join(dir, "config.md");
  let content: string;
  try {
    content = await readFile(configPath, "utf-8");
  } catch {
    return; // no config.md — nothing to update
  }

  // Check if the module section already exists
  const sectionRegex = new RegExp(`^### ${moduleName}\\s*\\n- enabled:\\s*(true|false)`, "m");
  const match = content.match(sectionRegex);

  if (match) {
    // Update existing section
    content = content.replace(sectionRegex, `### ${moduleName}\n- enabled: true`);
  } else {
    // Find the ## Modules section and append
    const modulesIdx = content.indexOf("## Modules");
    if (modulesIdx === -1) {
      // No Modules section — append one
      content += `\n## Modules\n\n### ${moduleName}\n- enabled: true\n`;
    } else {
      // Find the next ## section after Modules to insert before it
      const afterModules = content.indexOf("\n## ", modulesIdx + 10);
      const insertion = `\n### ${moduleName}\n- enabled: true\n`;
      if (afterModules === -1) {
        // Modules is the last section
        content += insertion;
      } else {
        content = content.slice(0, afterModules) + insertion + content.slice(afterModules);
      }
    }
  }

  await writeFile(configPath, content, "utf-8");
}
