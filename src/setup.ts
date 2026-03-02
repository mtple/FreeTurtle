import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LLMProvider } from "./llm.js";

interface ProviderInfo {
  label: string;
  credEnv: string;
  credField: "apiKey" | "oauthToken";
  defaultModel: string;
  prompt: string;
}

const PROVIDERS: Record<LLMProvider, ProviderInfo> = {
  claude_api: {
    label: "Anthropic (API key)",
    credEnv: "ANTHROPIC_API_KEY",
    credField: "apiKey",
    defaultModel: "claude-sonnet-4-5-20250514",
    prompt: "Paste your Anthropic API key (from console.anthropic.com/settings/keys)",
  },
  claude_subscription: {
    label: "Anthropic (Pro/Max subscription)",
    credEnv: "ANTHROPIC_AUTH_TOKEN",
    credField: "oauthToken",
    defaultModel: "claude-sonnet-4-5-20250514",
    prompt: "Paste your Anthropic auth token",
  },
  openai_api: {
    label: "OpenAI (API key)",
    credEnv: "OPENAI_API_KEY",
    credField: "apiKey",
    defaultModel: "gpt-4o-mini",
    prompt: "Paste your OpenAI API key (from platform.openai.com/api-keys)",
  },
  openai_subscription: {
    label: "OpenAI (subscription)",
    credEnv: "OPENAI_OAUTH_TOKEN",
    credField: "oauthToken",
    defaultModel: "gpt-4o-mini",
    prompt: "Paste your OpenAI OAuth token",
  },
  openrouter: {
    label: "OpenRouter (many models, some free)",
    credEnv: "OPENROUTER_API_KEY",
    credField: "apiKey",
    defaultModel: "anthropic/claude-sonnet-4-5",
    prompt: "Paste your OpenRouter API key (from openrouter.ai/keys)",
  },
};

const PROVIDER_ORDER: LLMProvider[] = [
  "claude_api",
  "openrouter",
  "openai_api",
  "claude_subscription",
  "openai_subscription",
];

export async function runSetup(dir: string): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    console.log("\n  FreeTurtle Setup\n");

    // 1. Pick provider
    console.log("  Which LLM provider do you want to use?\n");
    for (let i = 0; i < PROVIDER_ORDER.length; i++) {
      const key = PROVIDER_ORDER[i];
      console.log(`    ${i + 1}) ${PROVIDERS[key].label}`);
    }
    console.log();

    let providerIdx: number;
    for (;;) {
      const answer = await rl.question(`  Enter choice (1-${PROVIDER_ORDER.length}): `);
      providerIdx = parseInt(answer.trim(), 10) - 1;
      if (providerIdx >= 0 && providerIdx < PROVIDER_ORDER.length) break;
      console.log("  Invalid choice, try again.");
    }

    const providerKey = PROVIDER_ORDER[providerIdx];
    const info = PROVIDERS[providerKey];
    console.log(`\n  Selected: ${info.label}\n`);

    // 2. Get credential
    const credential = await rl.question(`  ${info.prompt}:\n  > `);
    if (!credential.trim()) {
      console.log("\n  No key provided. Setup cancelled.");
      return;
    }

    // 3. Model (offer default)
    const modelAnswer = await rl.question(
      `\n  Model (press Enter for ${info.defaultModel}):\n  > `
    );
    const model = modelAnswer.trim() || info.defaultModel;

    // 4. Write .env
    const envPath = join(dir, ".env");
    let existing = "";
    try {
      existing = await readFile(envPath, "utf-8");
    } catch {
      // no existing .env
    }

    const newVars: Record<string, string> = {
      LLM_PROVIDER: providerKey,
      LLM_MODEL: model,
      [info.credEnv]: credential.trim(),
    };

    const envContent = mergeEnv(existing, newVars);
    await writeFile(envPath, envContent, "utf-8");

    console.log(`\n  Saved to ${envPath}`);
    console.log("  You're all set!\n");
  } finally {
    rl.close();
  }
}

function mergeEnv(
  existing: string,
  vars: Record<string, string>
): string {
  const lines = existing ? existing.split("\n") : [];
  const remaining = { ...vars };

  // Update existing keys in-place
  const updated = lines.map((line) => {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match && match[1] in remaining) {
      const key = match[1];
      const val = remaining[key];
      delete remaining[key];
      return `${key}=${val}`;
    }
    return line;
  });

  // Append any new keys
  for (const [key, val] of Object.entries(remaining)) {
    updated.push(`${key}=${val}`);
  }

  // Ensure trailing newline
  const result = updated.join("\n");
  return result.endsWith("\n") ? result : result + "\n";
}
