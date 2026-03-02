import "dotenv/config";
import { LLMClient } from "./src/llm.js";
import type { ToolDefinition, ToolCall } from "./src/modules/types.js";

import type { LLMProvider } from "./src/llm.js";

const provider = (process.env.LLM_PROVIDER ?? "claude_api") as LLMProvider;

const ENV_MAP: Record<LLMProvider, { env: string; field: "apiKey" | "oauthToken" }> = {
  claude_api: { env: "ANTHROPIC_API_KEY", field: "apiKey" },
  claude_subscription: { env: "ANTHROPIC_AUTH_TOKEN", field: "oauthToken" },
  openai_api: { env: "OPENAI_API_KEY", field: "apiKey" },
  openai_subscription: { env: "OPENAI_OAUTH_TOKEN", field: "oauthToken" },
  openrouter: { env: "OPENROUTER_API_KEY", field: "apiKey" },
};

const { env: credEnv, field: credField } = ENV_MAP[provider];
const credential = process.env[credEnv];

if (!credential) {
  console.error(`Set ${credEnv} environment variable`);
  process.exit(1);
}

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  claude_api: "claude-sonnet-4-5-20250514",
  claude_subscription: "claude-sonnet-4-5-20250514",
  openai_api: "gpt-4o-mini",
  openai_subscription: "gpt-4o-mini",
  openrouter: "anthropic/claude-sonnet-4-5",
};

const client = new LLMClient({
  provider,
  model: process.env.LLM_MODEL ?? DEFAULT_MODELS[provider],
  [credField]: credential,
});

const tools: ToolDefinition[] = [
  {
    name: "get_current_time",
    description: "Returns the current time as an ISO 8601 timestamp.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

async function executor(call: ToolCall): Promise<string> {
  console.log(`[tool] ${call.name} called with:`, call.input);
  if (call.name === "get_current_time") {
    const time = new Date().toISOString();
    console.log(`[tool] returning: ${time}`);
    return time;
  }
  return "Unknown tool";
}

async function main() {
  console.log("Starting agent loop...\n");

  const result = await client.agentLoop(
    "You are a helpful assistant. Use the available tools to answer questions.",
    "What time is it right now?",
    tools,
    executor
  );

  console.log(`\n[result] ${result}`);
}

main().catch(console.error);
