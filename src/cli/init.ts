import * as p from "@clack/prompts";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { runSetup } from "../setup.js";
import { LLMClient } from "../llm.js";
import { connectFarcaster } from "./connect-farcaster.js";
import { scanForSecrets, redactSecrets, condenseDocs } from "./intake.js";
import { testTelegram, testGitHub, testDatabase, testOnchain } from "./connection-tests.js";

const TURTLE = `
        \x1b[38;2;94;255;164m_____\x1b[0m     \x1b[38;2;94;255;164m____\x1b[0m
       \x1b[38;2;94;255;164m/      \\\x1b[0m  \x1b[38;2;94;255;164m|  o |\x1b[0m
      \x1b[38;2;94;255;164m|        |/ ___\\|\x1b[0m
      \x1b[38;2;94;255;164m|_________/\x1b[0m
      \x1b[38;2;94;255;164m|_|_| |_|_|\x1b[0m

      \x1b[1mFreeTurtle\x1b[0m  \x1b[2mv0.1\x1b[0m
`;

const HATCH_FRAMES = [
  "  🥚",
  "  🥚  .",
  "  🥚  . .",
  "  🥚💥",
  "  🐢 !!",
];

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Collect multiline text from stdin using readline.
 * Ends when the user enters two consecutive blank lines or presses Ctrl+D.
 */
function readMultiline(): Promise<string> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    let consecutiveBlanks = 0;
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "" });
    rl.prompt();
    rl.on("line", (line) => {
      if (line.trim() === "") {
        consecutiveBlanks++;
        if (consecutiveBlanks >= 2) {
          rl.close();
          return;
        }
      } else {
        for (let i = 0; i < consecutiveBlanks; i++) lines.push("");
        consecutiveBlanks = 0;
        lines.push(line);
      }
    });
    rl.on("close", () => resolve(lines.join("\n").trim()));
  });
}

/**
 * Detect paste: if a p.text answer is longer than this, it was probably a paste.
 * Inspired by OpenClaw's burst coalescer — instead of draining stdin (which
 * interferes with clack), we detect paste from the submitted value itself and
 * capture it as business context.
 */
const PASTE_THRESHOLD = 200;

/**
 * Wrapper around p.text that detects accidental paste (answer > PASTE_THRESHOLD chars).
 * When paste is detected:
 *   1. Captures the pasted text as business context on state
 *   2. Drains remaining pasted lines from stdin via readMultiline()
 *   3. Re-asks the original question
 * Returns null on cancel.
 */
async function pasteAwareText(
  state: { businessContext: string },
  opts: Parameters<typeof p.text>[0]
): Promise<string | null> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await p.text(opts);
    if (p.isCancel(result)) return null;

    if (result.length > PASTE_THRESHOLD && !state.businessContext) {
      // Looks like a paste burst — capture the first line and drain the rest
      p.log.info("Looks like you pasted docs — collecting the rest...");
      const overflow = await readMultiline();
      state.businessContext = overflow ? result + "\n" + overflow : result;
      p.log.success(`Saved ${(state.businessContext.length / 1000).toFixed(0)}K chars as business context.`);
      // Re-ask the original question
      continue;
    }

    return result;
  }
}

async function hatchAnimation(): Promise<void> {
  for (const frame of HATCH_FRAMES) {
    process.stdout.write(`\r${frame}   `);
    await sleep(400);
  }
  process.stdout.write("\r              \r");
}

async function runConnectionTest(name: string, test: () => Promise<void>): Promise<void> {
  const s = p.spinner();
  s.start(`Testing ${name} connection`);
  try {
    await test();
    s.stop(`${name} connected!`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    s.stop(`${name} test failed: ${msg}`);
    p.log.warn("You can fix this later in ~/.freeturtle/.env");
  }
}

export async function runInit(dir: string): Promise<void> {
  console.log(TURTLE);
  await hatchAnimation();

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
      "Let's hatch your AI CEO — an autonomous agent that",
      "posts content, chats with you, writes strategy, and",
      "runs operations for your project.",
      "",
      "It'll only take a few minutes. You can always change",
      "settings later in ~/.freeturtle/",
    ].join("\n"),
    "🥚 Welcome"
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
    businessContext: string;
    contracts: { name: string; address: string }[];
  }

  const state: State = {
    projectName: "",
    description: "",
    ceoName: "",
    voice: "casual",
    founderName: "",
    businessContext: "",
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
      const result = await pasteAwareText(state, {
        message: "What project will this AI CEO be running?",
        placeholder: "e.g. Tortoise, Acme Corp, My Newsletter",
        defaultValue: state.projectName || undefined,
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
      if (result === null) return false;
      state.projectName = result;
      return true;
    },
    // 2. Description
    async () => {
      const result = await pasteAwareText(state, {
        message: "Describe the project in a sentence or two.",
        placeholder: "A music platform on Farcaster/Base for independent artists",
        defaultValue: state.description || undefined,
      });
      if (result === null) return false;
      state.description = result;
      return true;
    },
    // 3. Business context (optional, multiline-safe)
    async () => {
      // Skip if we already captured context from a paste burst
      if (state.businessContext) {
        p.log.info(`Using ${(state.businessContext.length / 1000).toFixed(0)}K chars of business context you pasted earlier.`);
        return true;
      }

      const wantContext = await p.confirm({
        message: "Want to dump docs about your business? (pitch deck, readme, strategy notes, etc.)",
        initialValue: false,
      });
      if (p.isCancel(wantContext)) return false;
      if (!wantContext) return true;

      p.log.info("Paste or type below. Two blank lines to finish.");

      let text = await readMultiline();

      if (text) {
        // Secret scan
        const secrets = scanForSecrets(text);
        if (secrets.length > 0) {
          p.log.warn("Detected possible secrets in your text:");
          for (const s of secrets) {
            p.log.warn(`  ${s}`);
          }
          const redact = await p.confirm({
            message: "Redact detected secrets?",
            initialValue: true,
          });
          if (!p.isCancel(redact) && redact) {
            text = redactSecrets(text);
            p.log.success("Secrets redacted.");
          }
        }
        state.businessContext = text;
        p.log.info(`Got it — ${(text.length / 1000).toFixed(0)}K chars of context.`);
      }
      return true;
    },
    // 4. CEO name
    async () => {
      const result = await pasteAwareText(state, {
        message: "What should your AI CEO be called?",
        placeholder: "e.g. Shelly, Atlas, Nova",
        defaultValue: state.ceoName || undefined,
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
      if (result === null) return false;
      state.ceoName = result;
      return true;
    },
    // 5. Voice
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
    // 6. Founder name
    async () => {
      const result = await pasteAwareText(state, {
        message: "Your name (the founder).",
        defaultValue: state.founderName || undefined,
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
      if (result === null) return false;
      state.founderName = result;
      return true;
    },
    // 7. Farcaster
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
    // 8. Telegram
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
            "1. Message @BotFather on Telegram \u2192 /newbot",
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

        // Test the token
        await runConnectionTest("Telegram", () => testTelegram(state.telegramToken));

        const owner = await promptWithExisting({ message: "Your Telegram user ID (numeric, from @userinfobot)", existing: existingEnv.TELEGRAM_OWNER_ID });
        if (p.isCancel(owner)) { state.telegram = false; return true; }
        state.telegramOwner = owner;
      }
      return true;
    },
    // 9. GitHub
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
            "2. Generate new token \u2192 Fine-grained token",
            "3. Select the repos your CEO should access",
            "4. Grant permissions: Issues (read/write), Contents (read/write)",
            "5. Copy the token \u2014 you won't see it again",
          ].join("\n"),
          "GitHub setup"
        );

        const token = await promptWithExisting({ message: "GitHub personal access token", existing: existingEnv.GITHUB_TOKEN, mask: true });
        if (p.isCancel(token)) { state.github = false; return true; }
        state.githubToken = token;

        // Test the token
        await runConnectionTest("GitHub", () => testGitHub(state.githubToken));
      }
      return true;
    },
    // 10. Database
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
            "Provide a Postgres connection string. The CEO can only",
            "run read-only queries \u2014 all writes are blocked.",
            "",
            "Supabase: Settings \u2192 Database \u2192 Connection string (URI)",
            "Local:    postgresql://localhost/your_db",
          ].join("\n"),
          "Database setup"
        );

        const url = await promptWithExisting({ message: "Database connection URL", existing: existingEnv.DATABASE_URL, placeholder: "postgres://user:pass@host:5432/dbname", mask: true });
        if (p.isCancel(url)) { state.database = false; return true; }
        state.dbUrl = url;

        // Test the connection
        await runConnectionTest("Database", () => testDatabase(state.dbUrl));
      }
      return true;
    },
    // 11. Onchain
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
            "Provide a Base mainnet RPC URL. Read-only \u2014 no wallet or signing.",
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

        // Test the RPC
        await runConnectionTest("RPC", () => testOnchain(state.rpcUrl));

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

  // --- LLM setup ---
  p.log.step("Let's pick a brain for your CEO.");
  const setupResult = await runSetup(dir);

  // --- Condense business context into soul if provided ---
  let soulContent: string | undefined;
  if (state.businessContext) {
    const llm = new LLMClient({
      provider: setupResult.provider,
      model: setupResult.model,
      apiKey: setupResult.apiKey,
      oauthToken: setupResult.oauthToken,
    });

    const s = p.spinner();
    s.start(`Distilling your context into ${state.ceoName}'s soul`);
    try {
      soulContent = await condenseDocs(
        state.businessContext,
        {
          ceoName: state.ceoName,
          projectName: state.projectName,
          description: state.description,
          founderName: state.founderName,
          voice: state.voice,
        },
        llm,
        state.contracts
      );
      s.stop("Soul distilled from your business context!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      s.stop(`Condensation failed: ${msg}`);
      p.log.warn("Falling back to the standard template.");
      soulContent = undefined;
    }

    // Show and confirm
    if (soulContent) {
      p.note(soulContent, `${state.ceoName}'s soul`);
      const accept = await p.select({
        message: "How does this look?",
        options: [
          { value: "accept", label: "Looks good" },
          { value: "retry", label: "Try again" },
          { value: "template", label: "Use the standard template instead" },
        ],
      });
      if (p.isCancel(accept)) {
        // Use what we have
      } else if (accept === "retry") {
        const s2 = p.spinner();
        s2.start("Regenerating...");
        try {
          soulContent = await condenseDocs(
            state.businessContext,
            {
              ceoName: state.ceoName,
              projectName: state.projectName,
              description: state.description,
              founderName: state.founderName,
              voice: state.voice,
            },
            llm,
            state.contracts
          );
          s2.stop("Done!");
          p.note(soulContent, `${state.ceoName}'s soul (v2)`);
        } catch {
          s2.stop("Failed again, using standard template.");
          soulContent = undefined;
        }
      } else if (accept === "template") {
        soulContent = undefined;
      }
    }
  }

  // --- Generate workspace with playful tasks ---

  const modules = [
    state.farcaster && "Farcaster",
    state.telegram && "Telegram",
    state.github && "GitHub",
    state.database && "Database",
    state.onchain && "Onchain",
  ].filter(Boolean);

  await p.tasks([
    {
      title: `Building ${state.ceoName}'s nest`,
      task: async () => {
        await mkdir(join(dir, "workspace", "memory", "session-notes"), { recursive: true });
        await mkdir(join(dir, "strategy"), { recursive: true });
        await sleep(300);
        return "Directories created";
      },
    },
    {
      title: `Teaching ${state.ceoName} to speak`,
      task: async () => {
        if (soulContent) {
          // Use the LLM-condensed soul
          await writeFile(join(dir, "soul.md"), soulContent + "\n", "utf-8");
        } else {
          // Standard template
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
        }
        await sleep(200);
        return "Soul written";
      },
    },
    {
      title: "Configuring the shell",
      task: async () => {
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
        await sleep(200);
        return "Config saved";
      },
    },
    {
      title: "Locking up the secrets",
      task: async () => {
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
        await sleep(150);
        return ".env secured (chmod 600)";
      },
    },
    {
      title: "Preparing memory banks",
      task: async () => {
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
        await sleep(150);
        return "Memory initialized";
      },
    },
  ]);

  p.log.success(`${state.ceoName} is taking shape!`);
  if (modules.length > 0) {
    p.log.info(`Connected: ${modules.join(", ")}`);
  }

  console.log(`
  ${state.ceoName} is ready. 🐢

  Start:    freeturtle start
  Chat:     freeturtle start --chat
  Status:   freeturtle status

  Config:   ~/.freeturtle/config.md
  Soul:     ~/.freeturtle/soul.md
  `);

  p.outro(`Go get 'em, ${state.ceoName}!`);
}
