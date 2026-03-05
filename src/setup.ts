import * as p from "@clack/prompts";
import { chmod, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LLMProvider } from "./llm.js";

interface ProviderInfo {
  label: string;
  hint: string;
  credEnv: string;
  credField: "apiKey" | "oauthToken";
  credEnvField: "api_key_env" | "oauth_token_env";
  defaultModel: string;
  credPrompt: string;
}

const PROVIDERS: Record<LLMProvider, ProviderInfo> = {
  claude_api: {
    label: "Anthropic",
    hint: "API key from console.anthropic.com",
    credEnv: "ANTHROPIC_API_KEY",
    credField: "apiKey",
    credEnvField: "api_key_env",
    defaultModel: "claude-sonnet-4-5-20250514",
    credPrompt: "Anthropic API key",
  },
  openrouter: {
    label: "OpenRouter",
    hint: "many models, some free — openrouter.ai",
    credEnv: "OPENROUTER_API_KEY",
    credField: "apiKey",
    credEnvField: "api_key_env",
    defaultModel: "anthropic/claude-sonnet-4-5",
    credPrompt: "OpenRouter API key",
  },
  openai_api: {
    label: "OpenAI",
    hint: "API key from platform.openai.com",
    credEnv: "OPENAI_API_KEY",
    credField: "apiKey",
    credEnvField: "api_key_env",
    defaultModel: "gpt-4o-mini",
    credPrompt: "OpenAI API key",
  },
  claude_subscription: {
    label: "Claude Pro/Max",
    hint: "recommended — use your existing subscription",
    credEnv: "ANTHROPIC_AUTH_TOKEN",
    credField: "oauthToken",
    credEnvField: "oauth_token_env",
    defaultModel: "claude-sonnet-4-5-20250514",
    credPrompt: "Anthropic auth token",
  },
  openai_subscription: {
    label: "ChatGPT Plus/Pro",
    hint: "recommended — use your existing subscription",
    credEnv: "OPENAI_OAUTH_TOKEN",
    credField: "oauthToken",
    credEnvField: "oauth_token_env",
    defaultModel: "gpt-4o-mini",
    credPrompt: "OpenAI OAuth token",
  },
};

const PROVIDER_ORDER: LLMProvider[] = [
  "claude_subscription",
  "openai_subscription",
  "claude_api",
  "openai_api",
  "openrouter",
];

export async function runSetup(dir: string): Promise<void> {
  const providerKey = (await p.select({
    message: "Which LLM provider?",
    options: PROVIDER_ORDER.map((key) => ({
      value: key,
      label: PROVIDERS[key].label,
      hint: PROVIDERS[key].hint,
    })),
  })) as LLMProvider;

  if (p.isCancel(providerKey)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const info = PROVIDERS[providerKey];

  const credential = (await p.text({
    message: info.credPrompt,
    validate: (v) => (v?.trim() ? undefined : "Required"),
  })) as string;

  if (p.isCancel(credential)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const model = (await p.text({
    message: "Model",
    placeholder: info.defaultModel,
  })) as string;

  if (p.isCancel(model)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const finalModel = model.trim() || info.defaultModel;

  // Write .env
  const envPath = join(dir, ".env");
  let existing = "";
  try {
    existing = await readFile(envPath, "utf-8");
  } catch {
    // no existing .env
  }

  const newVars: Record<string, string> = {
    LLM_PROVIDER: providerKey,
    LLM_MODEL: finalModel,
    [info.credEnv]: credential.trim(),
  };

  await writeFile(envPath, mergeEnv(existing, newVars), "utf-8");
  await chmod(envPath, 0o600);

  // Update config.md LLM section
  const configPath = join(dir, "config.md");
  try {
    let configContent = await readFile(configPath, "utf-8");
    configContent = updateConfigLlm(configContent, {
      provider: providerKey,
      model: finalModel,
      [info.credEnvField]: info.credEnv,
    });
    await writeFile(configPath, configContent, "utf-8");
  } catch {
    // config.md may not exist yet (standalone setup run)
  }

  p.log.success(`Saved to ${envPath}`);
}

function updateConfigLlm(
  content: string,
  values: Record<string, string>
): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inLlm = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "## LLM") {
      inLlm = true;
      result.push(line);
      continue;
    }

    if (inLlm && trimmed.startsWith("## ")) {
      inLlm = false;
    }

    if (inLlm && trimmed.startsWith("- ")) {
      const kvMatch = trimmed.match(/^- (\w+):\s*/);
      if (kvMatch && kvMatch[1] in values) {
        result.push(`- ${kvMatch[1]}: ${values[kvMatch[1]]}`);
        continue;
      }
      // Remove stale credential env fields when switching providers
      if (
        kvMatch &&
        (kvMatch[1] === "api_key_env" || kvMatch[1] === "oauth_token_env") &&
        !(kvMatch[1] in values)
      ) {
        continue;
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

function mergeEnv(
  existing: string,
  vars: Record<string, string>
): string {
  const lines = existing ? existing.split("\n") : [];
  const remaining = { ...vars };

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

  for (const [key, val] of Object.entries(remaining)) {
    updated.push(`${key}=${val}`);
  }

  const result = updated.join("\n");
  return result.endsWith("\n") ? result : result + "\n";
}
