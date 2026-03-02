import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LLMClient } from "./src/llm.js";
import type { LLMProvider } from "./src/llm.js";
import { TaskRunner } from "./src/runner.js";
import { createLogger } from "./src/logger.js";

// --- Resolve provider + credential (same logic as test-llm.ts) ---
const ENV_MAP: Record<LLMProvider, { env: string; field: "apiKey" | "oauthToken" }> = {
  claude_api: { env: "ANTHROPIC_API_KEY", field: "apiKey" },
  claude_subscription: { env: "ANTHROPIC_AUTH_TOKEN", field: "oauthToken" },
  openai_api: { env: "OPENAI_API_KEY", field: "apiKey" },
  openai_subscription: { env: "OPENAI_OAUTH_TOKEN", field: "oauthToken" },
  openrouter: { env: "OPENROUTER_API_KEY", field: "apiKey" },
};

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  claude_api: "claude-sonnet-4-5-20250514",
  claude_subscription: "claude-sonnet-4-5-20250514",
  openai_api: "gpt-4o-mini",
  openai_subscription: "gpt-4o-mini",
  openrouter: "anthropic/claude-sonnet-4-5",
};

const provider = (process.env.LLM_PROVIDER ?? "claude_api") as LLMProvider;
const { env: credEnv, field: credField } = ENV_MAP[provider];
const credential = process.env[credEnv];

if (!credential) {
  console.error(`Set ${credEnv} environment variable (or run 'freeturtle setup')`);
  process.exit(1);
}

// --- Set up a temp workspace ---
const testDir = join(tmpdir(), `freeturtle-test-${Date.now()}`);
mkdirSync(join(testDir, "workspace", "memory"), { recursive: true });

writeFileSync(
  join(testDir, "soul.md"),
  `# Shelly

## Identity
Shelly is a friendly sea turtle who helps onchain musicians share their art with the world.

## Voice
- Warm and encouraging, like a supportive friend
- Uses ocean metaphors occasionally
- Keeps things concise and genuine
- Never uses hashtags or corporate speak

## Knowledge
Shelly runs Tortoise, a music platform on Farcaster/Base where independent artists share and sell music as digital collectibles.

## Goals
- Help artists get discovered
- Grow the Tortoise community
- Post engaging content about new music drops

## Owner
Matt, the creator of Tortoise.
`,
  "utf-8"
);

writeFileSync(
  join(testDir, "config.md"),
  `# FreeTurtle Config

## LLM
- provider: ${provider}
- model: ${process.env.LLM_MODEL ?? DEFAULT_MODELS[provider]}
- max_tokens: 4096
`,
  "utf-8"
);

console.log(`Test workspace: ${testDir}\n`);

// --- Run the test ---
async function main() {
  const logger = createLogger();
  const client = new LLMClient({
    provider,
    model: process.env.LLM_MODEL ?? DEFAULT_MODELS[provider],
    [credField]: credential,
  });

  const runner = new TaskRunner(testDir, client, [], logger);

  console.log("Running task: Introduce yourself\n");
  const result = await runner.runTask({
    name: "intro",
    prompt: "Introduce yourself based on your soul. Keep it to 2-3 sentences.",
  });

  console.log(`\n--- Response ---\n${result.response}`);
  console.log(`\n--- Stats ---`);
  console.log(`Duration: ${result.durationMs}ms`);
  console.log(`Tools called: ${result.toolsCalled.length}`);
}

main().catch(console.error);
