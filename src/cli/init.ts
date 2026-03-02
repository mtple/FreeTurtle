import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runSetup } from "../setup.js";

const VOICE_PRESETS: Record<string, string> = {
  casual:
    "- Friendly and approachable, like talking to a smart friend\n- Uses casual language, occasional humor\n- Keeps things concise and genuine",
  professional:
    "- Clear and authoritative, backed by data\n- Professional tone without being stiff\n- Focuses on insights and value",
  minimalist:
    "- Brief and direct\n- Says more with less\n- No fluff, no filler",
};

export async function runInit(dir: string): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    console.log("\n  Let's set up your AI operator.\n");

    // 1. Project name
    const projectName = await rl.question("  What's your project called?\n  > ");
    if (!projectName.trim()) {
      console.log("  Cancelled.");
      return;
    }

    // 2. Description
    const description = await rl.question(
      "\n  Describe your project in a sentence or two:\n  > "
    );

    // 3. Operator name
    const operatorName = await rl.question(
      "\n  What should your operator be called?\n  > "
    );

    // 4. Voice
    console.log("\n  How should your operator communicate?");
    console.log("    1) Casual");
    console.log("    2) Professional");
    console.log("    3) Minimalist");
    console.log("    4) Custom\n");
    const voiceChoice = await rl.question("  Enter choice (1-4): ");
    let voice: string;
    if (voiceChoice.trim() === "4") {
      voice = await rl.question("  Describe the voice:\n  > ");
      voice = `- ${voice}`;
    } else {
      const key = ["casual", "professional", "minimalist"][
        parseInt(voiceChoice.trim(), 10) - 1
      ] ?? "casual";
      voice = VOICE_PRESETS[key];
    }

    // 5. Owner
    const ownerName = await rl.question("\n  Your name (the owner):\n  > ");

    // 6. Modules
    console.log("\n  Which integrations do you want to enable?\n");

    const farcaster = (await rl.question("  Connect Farcaster? (y/n): "))
      .trim().toLowerCase() === "y";
    let neynarKey = "", signerUuid = "", fid = "";
    if (farcaster) {
      neynarKey = (await rl.question("    Neynar API key: ")).trim();
      signerUuid = (await rl.question("    Farcaster signer UUID: ")).trim();
      fid = (await rl.question("    Farcaster FID: ")).trim();
    }

    const telegram = (await rl.question("  Connect Telegram? (y/n): "))
      .trim().toLowerCase() === "y";
    let telegramToken = "", telegramOwner = "";
    if (telegram) {
      telegramToken = (await rl.question("    Bot token: ")).trim();
      telegramOwner = (await rl.question("    Your Telegram user ID: ")).trim();
    }

    const github = (await rl.question("  Connect GitHub? (y/n): "))
      .trim().toLowerCase() === "y";
    let githubToken = "";
    if (github) {
      githubToken = (await rl.question("    GitHub token: ")).trim();
    }

    const database = (await rl.question("  Connect a database? (y/n): "))
      .trim().toLowerCase() === "y";
    let dbUrl = "";
    if (database) {
      dbUrl = (await rl.question("    Database URL: ")).trim();
    }

    const onchain = (await rl.question("  Connect onchain (Base)? (y/n): "))
      .trim().toLowerCase() === "y";
    let rpcUrl = "";
    if (onchain) {
      rpcUrl = (await rl.question("    RPC URL: ")).trim();
    }

    rl.close();

    // Create directory structure
    console.log(`\n  Creating workspace at ${dir}...\n`);
    await mkdir(join(dir, "workspace", "memory", "session-notes"), { recursive: true });
    await mkdir(join(dir, "strategy"), { recursive: true });

    // Generate soul.md
    const soulContent = `# ${operatorName.trim() || "Operator"}

## Identity
${operatorName.trim()} is the AI operator for ${projectName.trim()}.

## Voice
${voice}

## Knowledge
${description.trim()}

## Goals
- Grow the project and community
- Create engaging content
- Support the owner's strategic objectives

## Values & Boundaries
- Be honest and transparent
- Don't make claims you can't back up
- Escalate to the owner when unsure

## Owner
${ownerName.trim() || "The project creator"}.
`;
    await writeFile(join(dir, "soul.md"), soulContent, "utf-8");

    // Generate config.md
    const configLines = [
      "# FreeTurtle Config\n",
      "## LLM",
      "- provider: claude_api",
      "- model: claude-sonnet-4-5-20250514",
      "- max_tokens: 4096",
      "- api_key_env: ANTHROPIC_API_KEY",
      "",
      "## Cron",
      "### post",
      "- schedule: 0 */8 * * *",
      "- prompt: Check for any queued posts. If there's a new upload worth sharing, share it. Otherwise write an original post.",
      "",
      "### strategy",
      "- schedule: 0 4 * * 0",
      "- prompt: Analyze posting history, engagement, platform data. Write a strategy brief.",
      "- output: strategy/{{date}}.md",
      "",
      "## Channels",
      "### terminal",
      "- enabled: true",
      "",
      "### telegram",
      `- enabled: ${telegram}`,
      "",
      "## Modules",
      "### farcaster",
      `- enabled: ${farcaster}`,
      ...(farcaster ? ["- channel: tortoise"] : []),
      "",
      "### database",
      `- enabled: ${database}`,
      "",
      "### github",
      `- enabled: ${github}`,
      "",
      "### onchain",
      `- enabled: ${onchain}`,
      "",
    ];
    await writeFile(join(dir, "config.md"), configLines.join("\n"), "utf-8");

    // Generate .env
    const envLines: string[] = [];
    if (neynarKey) envLines.push(`NEYNAR_API_KEY=${neynarKey}`);
    if (signerUuid) envLines.push(`FARCASTER_SIGNER_UUID=${signerUuid}`);
    if (fid) envLines.push(`FARCASTER_FID=${fid}`);
    if (telegramToken) envLines.push(`TELEGRAM_BOT_TOKEN=${telegramToken}`);
    if (telegramOwner) envLines.push(`TELEGRAM_OWNER_ID=${telegramOwner}`);
    if (githubToken) envLines.push(`GITHUB_TOKEN=${githubToken}`);
    if (dbUrl) envLines.push(`DATABASE_URL=${dbUrl}`);
    if (rpcUrl) envLines.push(`RPC_URL=${rpcUrl}`);
    await writeFile(join(dir, ".env"), envLines.join("\n") + "\n", "utf-8");

    // Create empty memory files
    await writeFile(join(dir, "workspace", "memory", "posting-log.json"), "[]", "utf-8");
    await writeFile(join(dir, "workspace", "memory", "post-queue.json"), "[]", "utf-8");

    // Create default HEARTBEAT.md
    await writeFile(
      join(dir, "workspace", "HEARTBEAT.md"),
      `# Heartbeat Checklist

- Check if there are queued posts that need to go out
- Check if there are unanswered mentions
- Check if any scheduled tasks failed recently
- Note anything that needs the owner's attention
`,
      "utf-8"
    );

    console.log("  Done! Now configure your LLM provider:\n");

    // Run LLM setup
    await runSetup(dir);

    console.log(`  Setup complete! Run \`freeturtle start\` to launch your operator.\n`);
  } finally {
    rl.close();
  }
}
