import { execSync } from "node:child_process";

function detectPackageManager(): string {
  // Check if installed via pnpm
  try {
    const list = execSync("pnpm list -g freeturtle 2>/dev/null", { encoding: "utf-8" });
    if (list.includes("freeturtle")) return "pnpm";
  } catch { /* not pnpm */ }

  // Check if installed via yarn
  try {
    const list = execSync("yarn global list 2>/dev/null", { encoding: "utf-8" });
    if (list.includes("freeturtle")) return "yarn";
  } catch { /* not yarn */ }

  // Default to npm
  return "npm";
}

export async function runUpdate(): Promise<void> {
  const pm = detectPackageManager();
  const cmd = pm === "pnpm"
    ? "pnpm install -g freeturtle@latest"
    : pm === "yarn"
      ? "yarn global add freeturtle@latest"
      : "npm install -g freeturtle@latest";

  console.log(`Updating FreeTurtle via ${pm}...`);
  console.log(`  ${cmd}\n`);

  try {
    execSync(cmd, { stdio: "inherit" });
    console.log("\nFreeTurtle updated successfully.");
  } catch {
    console.error("\nUpdate failed. You can update manually:");
    console.error(`  ${cmd}`);
    process.exit(1);
  }
}
