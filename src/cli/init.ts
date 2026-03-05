import * as p from "@clack/prompts";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runSetup } from "../setup.js";
import { connectFarcaster } from "./connect-farcaster.js";

/** Prompt for a value, offering to reuse an existing one from .env */
async function promptWithExisting(opts: {
  message: string;
  existing?: string;
  placeholder?: string;
  mask?: boolean;
}): Promise<string | symbol> {
  if (opts.existing) {
    const display = opts.mask
      ? "••••" + opts.existing.slice(-4)
      : opts.existing.length > 20
        ? opts.existing.slice(0, 20) + "..."
        : opts.existing;
    const reuse = await p.confirm({
      message: `${opts.message}: use existing? (${display})`,
      initialValue: true,
    });
    if (p.isCancel(reuse)) return reuse;
    if (reuse) return opts.existing;
  }
  return p.text({
    message: opts.message,
    placeholder: opts.placeholder,
    validate: (v) => (v?.trim() ? undefined : "Required"),
  });
}

export async function runInit(dir: string): Promise<void> {
  p.intro("FreeTurtle");

  // Load existing .env values
  const existingEnv: Record<string, string> = {};
  try {
    const content = await readFile(join(dir, ".env"), "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match) existingEnv[match[1]] = match[2];
    }
  } catch {
    // No existing .env
  }

  p.note(
    [
      "You're about to create an AI CEO — an autonomous agent that",
      "posts content, chats with you, writes strategy, and runs",
      "operations for your project.",
      "",
      "You can always re-run init or edit the files directly",
      "in ~/.freeturtle/ to change settings.",
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
    contracts: { name: string; address: string }[];
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
    contracts: [],
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
        const result = await connectFarcaster(dir);
        if (result) {
          state.neynarKey = result.neynarKey;
          state.signerUuid = result.signerUuid;
          state.fid = result.fid;
        } else {
          state.farcaster = false;
        }
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
        p.note(
          [
            "1. Message @BotFather on Telegram → /newbot",
            "   Choose a name and username (must end in 'bot')",
            "   BotFather replies with your bot token",
            "",
            "2. To get your user ID, message @userinfobot on Telegram",
            "   It replies immediately with your numeric ID",
          ].join("\n"),
          "Telegram setup"
        );

        const token = await promptWithExisting({ message: "Bot token", existing: existingEnv.TELEGRAM_BOT_TOKEN, mask: true });
        if (p.isCancel(token)) { state.telegram = false; return true; }
        state.telegramToken = token;

        const owner = await promptWithExisting({ message: "Your Telegram user ID (numeric, from @userinfobot)", existing: existingEnv.TELEGRAM_OWNER_ID });
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
        p.note(
          [
            "1. Go to github.com/settings/tokens",
            "2. Generate new token → Fine-grained token",
            "3. Select the repos your operator should access",
            "4. Grant permissions: Issues (read/write), Contents (read/write)",
            "5. Copy the token — you won't see it again",
          ].join("\n"),
          "GitHub setup"
        );

        const token = await promptWithExisting({ message: "GitHub personal access token", existing: existingEnv.GITHUB_TOKEN, mask: true });
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
        p.note(
          [
            "Provide a Postgres connection string. The operator can only",
            "run read-only queries — all writes are blocked.",
            "",
            "Supabase: Settings → Database → Connection string (URI)",
            "Local:    postgresql://localhost/your_db",
          ].join("\n"),
          "Database setup"
        );

        const url = await promptWithExisting({ message: "Database connection URL", existing: existingEnv.DATABASE_URL, placeholder: "postgres://user:pass@host:5432/dbname", mask: true });
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
        p.note(
          [
            "Provide a Base mainnet RPC URL. Read-only — no wallet or signing.",
            "",
            "Free options:",
            "  Public:   https://mainnet.base.org",
            "  Coinbase: sign up at portal.cdp.coinbase.com",
            "  Alchemy:  sign up at alchemy.com",
            "  Infura:   sign up at infura.io",
          ].join("\n"),
          "Onchain setup"
        );

        const url = await promptWithExisting({ message: "Base RPC URL", existing: existingEnv.RPC_URL, placeholder: "https://mainnet.base.org" });
        if (p.isCancel(url)) { state.onchain = false; return true; }
        state.rpcUrl = url;

        // Collect smart contracts
        const addContracts = await p.confirm({
          message: "Add smart contracts for your CEO to track?",
          initialValue: state.contracts.length > 0,
        });
        if (p.isCancel(addContracts)) return true;

        if (addContracts) {
          p.note(
            [
              "Add contracts your business uses on Base.",
              "Your CEO will be able to read data from these.",
              "",
              "You can add more later by editing soul.md.",
            ].join("\n"),
            "Smart contracts"
          );

          let adding = true;
          while (adding) {
            const name = await p.text({
              message: "Contract name",
              placeholder: "e.g. MyToken, Marketplace, NFT Collection",
              validate: (v) => (v?.trim() ? undefined : "Required"),
            });
            if (p.isCancel(name)) break;

            const address = await p.text({
              message: "Contract address",
              placeholder: "0x...",
              validate: (v) => {
                if (!v?.trim()) return "Required";
                if (!/^0x[a-fA-F0-9]{40}$/.test(v.trim())) return "Must be a valid 0x address (42 characters)";
                return undefined;
              },
            });
            if (p.isCancel(address)) break;

            state.contracts.push({ name, address });
            p.log.success(`Added ${name} (${address})`);

            const more = await p.confirm({
              message: "Add another contract?",
              initialValue: false,
            });
            if (p.isCancel(more) || !more) adding = false;
          }
        }
      }
      return true;
    },
  ];

  // Run steps — Ctrl+C exits immediately
  for (let i = 0; i < steps.length; i++) {
    const ok = await steps[i]();
    if (!ok) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
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
${state.contracts.length > 0 ? `\n### Smart Contracts (Base)\n${state.contracts.map((c) => `- ${c.name}: \`${c.address}\``).join("\n")}\n` : ""}
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
    "## Policy",
    "### github",
    "- approval_required_branches: main",
    "",
    "### approvals",
    "- timeout_seconds: 300",
    "- fail_mode: deny",
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
  const envFilePath = join(dir, ".env");
  await writeFile(envFilePath, envLines.join("\n") + "\n", "utf-8");
  await chmod(envFilePath, 0o600);

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
