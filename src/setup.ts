import * as p from "@clack/prompts";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chmod, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LLMProvider } from "./llm.js";
import {
  type OpenAIOAuthTokens,
  buildOpenAIOAuthAuthorizeUrl,
  exchangeOpenAIOAuthCode,
} from "./oauth/openai.js";

export interface SetupResult {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  oauthToken?: string;
}

interface ProviderInfo {
  label: string;
  hint: string;
  credEnv: string;
  credField: "apiKey" | "oauthToken";
  credEnvField: "api_key_env" | "oauth_token_env";
  defaultModel: string;
  credPrompt: string;
}

interface CodexAuthFile {
  access_token?: unknown;
  tokens?: {
    access_token?: unknown;
  };
}

const PROVIDERS: Record<LLMProvider, ProviderInfo> = {
  claude_api: {
    label: "Anthropic",
    hint: "API key from console.anthropic.com",
    credEnv: "ANTHROPIC_API_KEY",
    credField: "apiKey",
    credEnvField: "api_key_env",
    defaultModel: "claude-sonnet-4-5",
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
    defaultModel: "gpt-4.1-mini",
    credPrompt: "OpenAI API key",
  },
  claude_subscription: {
    label: "Claude Pro/Max",
    hint: "generate a setup-token with `claude setup-token`",
    credEnv: "ANTHROPIC_AUTH_TOKEN",
    credField: "oauthToken",
    credEnvField: "oauth_token_env",
    defaultModel: "claude-sonnet-4-5",
    credPrompt: "Claude setup-token",
  },
  openai_subscription: {
    label: "ChatGPT Plus/Pro",
    hint: "sign in via Codex OAuth (`codex --login`)",
    credEnv: "OPENAI_OAUTH_TOKEN",
    credField: "oauthToken",
    credEnvField: "oauth_token_env",
    defaultModel: "gpt-4.1-mini",
    credPrompt: "OpenAI Codex access token",
  },
};

const PROVIDER_ORDER: LLMProvider[] = [
  "claude_subscription",
  "openai_subscription",
  "claude_api",
  "openai_api",
  "openrouter",
];

export async function runSetup(dir: string): Promise<SetupResult> {
  const providerKey = (await p.select({
    message: "Pick a brain for your CEO",
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
  const envPath = join(dir, ".env");
  let existing = "";
  try {
    existing = await readFile(envPath, "utf-8");
  } catch {
    // no existing .env
  }
  const existingEnv = parseEnv(existing);

  // Show credential instructions
  const credInstructions: Record<string, string[]> = {
    claude_api: [
      "Get your API key from:",
      "  console.anthropic.com/settings/keys",
    ],
    claude_subscription: [
      "Use the Anthropic setup-token flow (same as OpenClaw):",
      "  1. Run `claude setup-token` on any machine",
      "  2. Paste that token below",
      "",
      "Note: this is setup-token auth, not browser OAuth login.",
    ],
    openai_api: [
      "Get your API key from:",
      "  platform.openai.com/api-keys",
    ],
    openai_subscription: [
      "Use OpenAI Codex OAuth (same as OpenClaw):",
      "  1. FreeTurtle generates an auth URL",
      "  2. Open the URL and sign in with ChatGPT",
      "  3. Callback is captured on localhost:1455 (or paste redirect URL/code)",
      "  4. FreeTurtle exchanges code at auth.openai.com/oauth/token",
    ],
    openrouter: [
      "Get your API key from:",
      "  openrouter.ai/keys",
    ],
  };

  const instructions = credInstructions[providerKey];
  if (instructions) {
    p.note(instructions.join("\n"), info.label + " credentials");
  }

  let credential: string | symbol;
  let openaiSubscriptionTokens: OpenAIOAuthTokens | null = null;

  if (providerKey === "claude_subscription") {
    const existingToken = existingEnv[info.credEnv];
    if (existingToken) {
      const useExisting = await p.confirm({
        message: `Found existing Claude setup-token in .env (••••${existingToken.slice(-6)}). Use it?`,
        initialValue: true,
      });
      if (p.isCancel(useExisting)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }
      if (useExisting) {
        credential = existingToken;
      } else {
        credential = await p.text({
          message: info.credPrompt,
          validate: (v) => (v?.trim() ? undefined : "Required"),
        });
      }
    } else {
      credential = await p.text({
        message: info.credPrompt,
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
    }
  } else if (providerKey === "openai_subscription") {
    const oauthTokens = await runOpenAICodexOAuthFlow();
    if (oauthTokens) {
      openaiSubscriptionTokens = oauthTokens;
      credential = oauthTokens.accessToken;
    } else {
      const detected = await readCodexAccessToken();
      if (detected) {
        const masked = `••••${detected.slice(-6)}`;
        const useDetected = await p.confirm({
          message: `OAuth not completed. Found Codex access token in ~/.codex/auth.json (${masked}). Use it?`,
          initialValue: true,
        });
        if (p.isCancel(useDetected)) {
          p.cancel("Setup cancelled.");
          process.exit(0);
        }
        if (useDetected) {
          credential = detected;
        } else {
          credential = await p.text({
            message: info.credPrompt,
            validate: (v) => (v?.trim() ? undefined : "Required"),
          });
        }
      } else {
        credential = await p.text({
          message: info.credPrompt,
          validate: (v) => (v?.trim() ? undefined : "Required"),
        });
      }
    }
  } else {
    credential = await p.text({
      message: info.credPrompt,
      validate: (v) => (v?.trim() ? undefined : "Required"),
    });
  }

  if (p.isCancel(credential)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
  const credentialValue = credential.trim();

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
  const newVars: Record<string, string> = {
    LLM_PROVIDER: providerKey,
    LLM_MODEL: finalModel,
    [info.credEnv]: credentialValue,
  };
  if (providerKey === "openai_subscription" && openaiSubscriptionTokens) {
    if (openaiSubscriptionTokens.refreshToken) {
      newVars.OPENAI_OAUTH_REFRESH_TOKEN = openaiSubscriptionTokens.refreshToken;
    }
    if (typeof openaiSubscriptionTokens.expiresAt === "number") {
      newVars.OPENAI_OAUTH_EXPIRES_AT = String(openaiSubscriptionTokens.expiresAt);
    }
  }

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

  p.log.success(`Brain connected! Using ${info.label} / ${finalModel}`);

  const result: SetupResult = { provider: providerKey, model: finalModel };
  if (info.credField === "apiKey") {
    result.apiKey = credentialValue;
  } else {
    result.oauthToken = credentialValue;
  }
  return result;
}

async function readCodexAccessToken(): Promise<string | null> {
  const home = process.env.HOME;
  if (!home) return null;

  const authPath = join(home, ".codex", "auth.json");
  try {
    const raw = await readFile(authPath, "utf-8");
    const parsed = JSON.parse(raw) as CodexAuthFile;
    const tokenCandidates = [
      parsed.tokens?.access_token,
      parsed.access_token,
    ];

    for (const candidate of tokenCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  } catch {
    // ignore missing/invalid Codex auth file
  }

  return null;
}

async function runOpenAICodexOAuthFlow(): Promise<OpenAIOAuthTokens | null> {
  const start = await p.confirm({
    message: "Start OpenAI Codex OAuth login now?",
    initialValue: true,
  });
  if (p.isCancel(start)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
  if (!start) return null;

  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = sha256Base64Url(codeVerifier);

  const authUrl = buildOpenAIOAuthAuthorizeUrl(state, codeChallenge);

  p.note(
    [
      "Open this URL in your browser and sign in with ChatGPT:",
      authUrl,
      "",
      "After approving, you'll be redirected to localhost:1455.",
      "If auto-capture fails, paste the final redirect URL or code.",
    ].join("\n"),
    "OpenAI OAuth"
  );

  const spinner = p.spinner();
  spinner.start("Waiting for OAuth callback on http://127.0.0.1:1455/auth/callback");
  const callback = await waitForOpenAICallback(state, 120_000);
  spinner.stop(callback ? "OAuth callback received" : "No callback captured");

  let code = callback?.code ?? null;
  if (!code) {
    const pasted = await p.text({
      message: "Paste redirect URL (or just the code)",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    });
    if (p.isCancel(pasted)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    code = extractCodeFromInput(pasted, state);
    if (!code) {
      p.log.warn("Could not parse a valid OAuth code. Skipping OAuth login.");
      return null;
    }
  }

  spinner.start("Exchanging OAuth code for token");
  try {
    const tokens = await exchangeOpenAIOAuthCode(code, codeVerifier);
    spinner.stop("OAuth login complete");
    return tokens;
  } catch (err) {
    spinner.stop("Token exchange failed");
    const msg = err instanceof Error ? err.message : "Unknown error";
    p.log.warn(`OpenAI OAuth token exchange failed: ${msg}`);
    return null;
  }
}

function waitForOpenAICallback(
  expectedState: string,
  timeoutMs: number
): Promise<{ code: string } | null> {
  return new Promise((resolve) => {
    let finished = false;
    const complete = (value: { code: string } | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(value);
    };

    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost:1455");
        if (url.pathname !== "/auth/callback") {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state || state !== expectedState) {
          res.statusCode = 400;
          res.end("Invalid OAuth callback.");
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          "<!doctype html><html><body><h3>Authentication successful.</h3><p>Return to your terminal.</p></body></html>"
        );
        void server.close();
        complete({ code });
      } catch {
        res.statusCode = 400;
        res.end("Invalid callback.");
      }
    });

    server.on("error", () => {
      complete(null);
    });

    server.listen(1455, "127.0.0.1");

    const timer = setTimeout(() => {
      void server.close();
      complete(null);
    }, timeoutMs);
  });
}

function extractCodeFromInput(input: string, expectedState: string): string | null {
  const value = input.trim();
  if (!value) return null;

  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return value;
  }

  try {
    const url = new URL(value);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code) return null;
    if (state && state !== expectedState) return null;
    return code;
  } catch {
    return null;
  }
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function parseEnv(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    parsed[match[1]] = match[2];
  }
  return parsed;
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
