import * as p from "@clack/prompts";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runSetup } from "../setup.js";

export async function runInit(dir: string): Promise<void> {
  p.intro("FreeTurtle");

  p.note(
    [
      "You're about to create an AI CEO — an autonomous agent that",
      "posts content, chats with you, writes strategy, and runs",
      "operations for your project.",
      "",
      "You can always change these settings later by editing the",
      "files in ~/.freeturtle/",
    ].join("\n"),
    "Welcome"
  );

  // --- Step-based flow with back support ---

  interface State {
    projectName: string;
    description: string;
    ceoName: string;
    voice: string;
    founderName: string;
    farcaster: boolean;
    neynarKey: string;
    signerUuid: string;
    fid: string;
    telegram: boolean;
    telegramToken: string;
    telegramOwner: string;
    github: boolean;
    githubToken: string;
    database: boolean;
    dbUrl: string;
    onchain: boolean;
    rpcUrl: string;
  }

  const state: State = {
    projectName: "",
    description: "",
    ceoName: "",
    voice: "casual",
    founderName: "",
    farcaster: false,
    neynarKey: "",
    signerUuid: "",
    fid: "",
    telegram: false,
    telegramToken: "",
    telegramOwner: "",
    github: false,
    githubToken: "",
    database: false,
    dbUrl: "",
    onchain: false,
    rpcUrl: "",
  };

  const steps: (() => Promise<boolean>)[] = [
    // 1. Project name
    async () => {
      const result = await p.text({
        message: "What project will this AI CEO be running?",
        placeholder: "e.g. Tortoise, Acme Corp, My Newsletter",
        defaultValue: state.projectName || undefined,
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
      if (p.isCancel(result)) return false;
      state.projectName = result;
      return true;
    },
    // 2. Description
    async () => {
      const result = await p.text({
        message: "Describe the project in a sentence or two.",
        placeholder: "A music platform on Farcaster/Base for independent artists",
        defaultValue: state.description || undefined,
      });
      if (p.isCancel(result)) return false;
      state.description = result;
      return true;
    },
    // 3. CEO name
    async () => {
      const result = await p.text({
        message: "What should your AI CEO be called?",
        placeholder: "e.g. Shelly, Atlas, Nova",
        defaultValue: state.ceoName || undefined,
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
      if (p.isCancel(result)) return false;
      state.ceoName = result;
      return true;
    },
    // 4. Voice
    async () => {
      const result = await p.select({
        message: "How should your CEO communicate?",
        options: [
          { value: "casual", label: "Casual", hint: "friendly, like a smart friend" },
          { value: "professional", label: "Professional", hint: "clear, authoritative, data-driven" },
          { value: "minimalist", label: "Minimalist", hint: "brief and direct, no fluff" },
        ],
        initialValue: state.voice,
      });
      if (p.isCancel(result)) return false;
      state.voice = result as string;
      return true;
    },
    // 5. Founder name
    async () => {
      const result = await p.text({
        message: "Your name (the founder).",
        defaultValue: state.founderName || undefined,
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
      if (p.isCancel(result)) return false;
      state.founderName = result;
      return true;
    },
    // 6. Farcaster
    async () => {
      const enable = await p.confirm({
        message: "Connect Farcaster? (post and read casts via Neynar)",
        initialValue: state.farcaster,
      });
      if (p.isCancel(enable)) return false;
      state.farcaster = enable;
      if (enable) {
        const key = await p.text({ message: "  Neynar API key", validate: (v) => (v?.trim() ? undefined : "Required") });
        if (p.isCancel(key)) { state.farcaster = false; return true; }
        state.neynarKey = key;

        const signer = await p.text({ message: "  Farcaster signer UUID", validate: (v) => (v?.trim() ? undefined : "Required") });
        if (p.isCancel(signer)) { state.farcaster = false; return true; }
        state.signerUuid = signer;

        const fid = await p.text({ message: "  Farcaster FID (optional)", placeholder: "press Enter to skip" });
        if (p.isCancel(fid)) { state.farcaster = false; return true; }
        state.fid = fid;
      }
      return true;
    },
    // 7. Telegram
    async () => {
      const enable = await p.confirm({
        message: "Connect Telegram? (chat with your CEO via bot)",
        initialValue: state.telegram,
      });
      if (p.isCancel(enable)) return false;
      state.telegram = enable;
      if (enable) {
        const token = await p.text({ message: "  Bot token", validate: (v) => (v?.trim() ? undefined : "Required") });
        if (p.isCancel(token)) { state.telegram = false; return true; }
        state.telegramToken = token;

        const owner = await p.text({ message: "  Your Telegram user ID", validate: (v) => (v?.trim() ? undefined : "Required") });
        if (p.isCancel(owner)) { state.telegram = false; return true; }
        state.telegramOwner = owner;
      }
      return true;
    },
    // 8. GitHub
    async () => {
      const enable = await p.confirm({
        message: "Connect GitHub? (issues and file commits)",
        initialValue: state.github,
      });
      if (p.isCancel(enable)) return false;
      state.github = enable;
      if (enable) {
        const token = await p.text({ message: "  GitHub personal access token", validate: (v) => (v?.trim() ? undefined : "Required") });
        if (p.isCancel(token)) { state.github = false; return true; }
        state.githubToken = token;
      }
      return true;
    },
    // 9. Database
    async () => {
      const enable = await p.confirm({
        message: "Connect a database? (read-only Postgres queries)",
        initialValue: state.database,
      });
      if (p.isCancel(enable)) return false;
      state.database = enable;
      if (enable) {
        const url = await p.text({
          message: "  Database connection URL",
          placeholder: "postgres://user:pass@host:5432/dbname",
          validate: (v) => (v?.trim() ? undefined : "Required"),
        });
        if (p.isCancel(url)) { state.database = false; return true; }
        state.dbUrl = url;
      }
      return true;
    },
    // 10. Onchain
    async () => {
      const enable = await p.confirm({
        message: "Connect onchain? (read contracts and balances on Base)",
        initialValue: state.onchain,
      });
      if (p.isCancel(enable)) return false;
      state.onchain = enable;
      if (enable) {
        const url = await p.text({
          message: "  Base RPC URL",
          placeholder: "https://mainnet.base.org",
          validate: (v) => (v?.trim() ? undefined : "Required"),
        });
        if (p.isCancel(url)) { state.onchain = false; return true; }
        state.rpcUrl = url;
      }
      return true;
    },
  ];

  // Run steps with Ctrl+C = go back
  let i = 0;
  while (i < steps.length) {
    const ok = await steps[i]();
    if (!ok) {
      if (i === 0) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }
      i--; // go back
      continue;
    }
    i++;
  }

  // --- Generate workspace ---

  const s = p.spinner();
  s.start("Creating workspace");

  await mkdir(join(dir, "workspace", "memory", "session-notes"), { recursive: true });
  await mkdir(join(dir, "strategy"), { recursive: true });

  const VOICE: Record<string, string> = {
    casual:
      "- Friendly and approachable, like talking to a smart friend\n- Uses casual language, occasional humor\n- Keeps things concise and genuine",
    professional:
      "- Clear and authoritative, backed by data\n- Professional tone without being stiff\n- Focuses on insights and value",
    minimalist:
      "- Brief and direct\n- Says more with less\n- No fluff, no filler",
  };

  await writeFile(
    join(dir, "soul.md"),
    `# ${state.ceoName}

## Identity
${state.ceoName} is the AI CEO for ${state.projectName}.

## Voice
${VOICE[state.voice] ?? VOICE.casual}

## Knowledge
${state.description}

## Goals
- Grow the project and community
- Create engaging content
- Develop and execute strategy
- Support the founder's objectives

## Values & Boundaries
- Be honest and transparent
- Don't make claims you can't back up
- Escalate to the founder when unsure

## Founder
${state.founderName}.
`,
    "utf-8"
  );

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
    `- enabled: ${state.telegram}`,
    "",
    "## Modules",
    "### farcaster",
    `- enabled: ${state.farcaster}`,
    "",
    "### database",
    `- enabled: ${state.database}`,
    "",
    "### github",
    `- enabled: ${state.github}`,
    "",
    "### onchain",
    `- enabled: ${state.onchain}`,
    "",
  ];
  await writeFile(join(dir, "config.md"), configLines.join("\n"), "utf-8");

  const envLines: string[] = [];
  if (state.neynarKey) envLines.push(`NEYNAR_API_KEY=${state.neynarKey}`);
  if (state.signerUuid) envLines.push(`FARCASTER_SIGNER_UUID=${state.signerUuid}`);
  if (state.fid) envLines.push(`FARCASTER_FID=${state.fid}`);
  if (state.telegramToken) envLines.push(`TELEGRAM_BOT_TOKEN=${state.telegramToken}`);
  if (state.telegramOwner) envLines.push(`TELEGRAM_OWNER_ID=${state.telegramOwner}`);
  if (state.githubToken) envLines.push(`GITHUB_TOKEN=${state.githubToken}`);
  if (state.dbUrl) envLines.push(`DATABASE_URL=${state.dbUrl}`);
  if (state.rpcUrl) envLines.push(`RPC_URL=${state.rpcUrl}`);
  await writeFile(join(dir, ".env"), envLines.join("\n") + "\n", "utf-8");

  await writeFile(join(dir, "workspace", "memory", "posting-log.json"), "[]", "utf-8");
  await writeFile(join(dir, "workspace", "memory", "post-queue.json"), "[]", "utf-8");

  await writeFile(
    join(dir, "workspace", "HEARTBEAT.md"),
    `# Heartbeat Checklist

- Check if there are queued posts that need to go out
- Check if there are unanswered mentions
- Check if any scheduled tasks failed recently
- Note anything that needs the founder's attention
`,
    "utf-8"
  );

  s.stop("Workspace created");

  // --- LLM setup ---
  await runSetup(dir);

  p.outro("Setup complete! Run `freeturtle start` to launch your CEO.");
}
