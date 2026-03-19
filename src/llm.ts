import { execSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type {
  ToolDefinition,
  ToolCall,
  ToolExecutor,
} from "./modules/types.js";
import { withRetry } from "./reliability.js";

const FALLBACK_CLAUDE_VERSION = "2.1.79";

function detectClaudeCodeVersion(): string {
  try {
    const output = execSync("claude --version 2>/dev/null", { timeout: 5000, encoding: "utf-8" });
    const match = output.match(/(\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch {
    // Claude Code not installed or not in PATH
  }
  return FALLBACK_CLAUDE_VERSION;
}

export type LLMProvider =
  | "claude_api"
  | "claude_subscription"
  | "openai_api"
  | "openai_subscription"
  | "openrouter";

export interface ConversationTurn {
  userMessage: string;
  assistantResponse: string;
}

export interface LLMClientOptions {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  oauthToken?: string;
  baseUrl?: string;
}

export interface LLMResponse {
  text: string;
  tool_calls: ToolCall[];
}

export class LLMClient {
  private provider: "anthropic" | "openai";
  private model: string;
  private mode: LLMProvider;
  private anthropic?: Anthropic;
  private openai?: OpenAI;
  private anthropicClaudeCodeOAuth = false;
  private openaiCodexSubscription = false;

  constructor(options: LLMClientOptions) {
    this.mode = options.provider;
    this.provider = this.mode.startsWith("claude") ? "anthropic" : "openai";
    this.model = options.model;

    if (this.mode === "claude_api") {
      if (!options.apiKey) {
        throw new Error("LLMClient missing required credential: apiKey");
      }
      this.anthropic = new Anthropic({
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
      });
      return;
    }

    if (this.mode === "claude_subscription") {
      if (!options.oauthToken) {
        throw new Error("LLMClient missing required credential: oauthToken");
      }
      const isOAuthToken = options.oauthToken.includes("sk-ant-oat");
      this.anthropicClaudeCodeOAuth = isOAuthToken;

      if (isOAuthToken) {
        const ccVersion = detectClaudeCodeVersion();
        // Match Claude Code OAuth transport for subscription tokens.
        this.anthropic = new Anthropic({
          authToken: options.oauthToken,
          baseURL: options.baseUrl,
          dangerouslyAllowBrowser: true,
          defaultHeaders: {
            accept: "application/json",
            "anthropic-dangerous-direct-browser-access": "true",
            "anthropic-beta":
              "claude-code-20250219,oauth-2025-04-20",
            "user-agent": `claude-cli/${ccVersion}`,
            "x-app": "cli",
          },
        });
      } else {
        // Setup-tokens can be passed as apiKey-style credentials.
        this.anthropic = new Anthropic({
          apiKey: options.oauthToken,
          baseURL: options.baseUrl,
        });
      }
      return;
    }

    if (this.mode === "openai_api") {
      if (!options.apiKey) {
        throw new Error("LLMClient missing required credential: apiKey");
      }
      this.openai = new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
      });
      return;
    }

    if (this.mode === "openai_subscription") {
      if (!options.oauthToken) {
        throw new Error("LLMClient missing required credential: oauthToken");
      }
      const accountId = extractOpenAIAccountId(options.oauthToken);
      this.openaiCodexSubscription = true;
      this.openai = new OpenAI({
        apiKey: options.oauthToken,
        baseURL: options.baseUrl ?? "https://chatgpt.com/backend-api/codex",
        defaultHeaders: {
          "chatgpt-account-id": accountId,
          "OpenAI-Beta": "responses=experimental",
          originator: "pi",
        },
      });
      return;
    }

    // openrouter
    if (!options.apiKey) {
      throw new Error("LLMClient missing required credential: apiKey");
    }
    this.openai = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl ?? "https://openrouter.ai/api/v1",
    });
  }

  async chat(
    systemPrompt: string,
    messages: Anthropic.MessageParam[] | OpenAI.ChatCompletionMessageParam[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    if (this.provider === "anthropic") {
      return this.chatAnthropic(
        systemPrompt,
        messages as Anthropic.MessageParam[],
        tools
      );
    }
    return this.chatOpenAI(
      systemPrompt,
      messages as OpenAI.ChatCompletionMessageParam[],
      tools
    );
  }

  async agentLoop(
    systemPrompt: string,
    userPrompt: string,
    tools: ToolDefinition[],
    toolExecutor: ToolExecutor,
    priorHistory?: ConversationTurn[],
    images?: import("./channels/types.js").MessageImage[],
  ): Promise<{ text: string; newTurns: ConversationTurn[] }> {
    if (this.provider === "anthropic") {
      return this.agentLoopAnthropic(
        systemPrompt,
        userPrompt,
        tools,
        toolExecutor,
        priorHistory,
        images,
      );
    }
    return this.agentLoopOpenAI(
      systemPrompt,
      userPrompt,
      tools,
      toolExecutor,
      priorHistory,
    );
  }

  // --- Anthropic implementation ---

  private async chatAnthropic(
    systemPrompt: string,
    messages: Anthropic.MessageParam[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    const effectiveSystemPrompt = this.anthropicClaudeCodeOAuth
      ? [
          "You are Claude Code, Anthropic's official CLI for Claude.",
          systemPrompt,
        ].join("\n\n")
      : systemPrompt;

    const response = await withRetry(
      () =>
        this.anthropic!.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: effectiveSystemPrompt,
          messages,
          ...(tools?.length
            ? {
                tools: tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  input_schema: t.input_schema as Anthropic.Tool["input_schema"],
                })),
              }
            : {}),
        }),
      { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 60000, timeoutMs: 120000 },
    );

    let text = "";
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return { text, tool_calls: toolCalls };
  }

  private async agentLoopAnthropic(
    systemPrompt: string,
    userPrompt: string,
    tools: ToolDefinition[],
    toolExecutor: ToolExecutor,
    priorHistory?: ConversationTurn[],
    images?: import("./channels/types.js").MessageImage[],
  ): Promise<{ text: string; newTurns: ConversationTurn[] }> {
    const MAX_ITERATIONS = 25;
    const messages: Anthropic.MessageParam[] = [];

    // Prepend prior conversation history
    if (priorHistory?.length) {
      for (const turn of priorHistory) {
        messages.push({ role: "user", content: turn.userMessage });
        messages.push({ role: "assistant", content: turn.assistantResponse });
      }
    }

    // Build user message with optional images
    if (images?.length) {
      const content: Anthropic.ContentBlockParam[] = [];
      for (const img of images) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: img.data,
          },
        });
      }
      content.push({ type: "text", text: userPrompt });
      messages.push({ role: "user", content });
    } else {
      messages.push({ role: "user", content: userPrompt });
    }

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.chatAnthropic(systemPrompt, messages, tools);

      if (response.tool_calls.length === 0) {
        return {
          text: response.text,
          newTurns: [{ userMessage: userPrompt, assistantResponse: response.text }],
        };
      }

      // Build assistant content blocks
      const assistantContent: Anthropic.ContentBlockParam[] = [];
      if (response.text) {
        assistantContent.push({ type: "text", text: response.text });
      }
      for (const tc of response.tool_calls) {
        assistantContent.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }
      messages.push({ role: "assistant", content: assistantContent });

      // Execute tools and build results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tc of response.tool_calls) {
        const result = await toolExecutor(tc);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: result,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    // If we hit the limit, return whatever text we have
    const last = await this.chatAnthropic(systemPrompt, messages, []);
    const text = last.text || "(Agent reached maximum tool call iterations)";
    return {
      text,
      newTurns: [{ userMessage: userPrompt, assistantResponse: text }],
    };
  }

  // --- OpenAI implementation ---

  private async chatOpenAI(
    systemPrompt: string,
    messages: OpenAI.ChatCompletionMessageParam[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    if (this.openaiCodexSubscription) {
      return this.chatOpenAICodexResponses(systemPrompt, messages, tools);
    }

    const response = await this.openai!.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      ...(tools?.length
        ? {
            tools: tools.map((t) => ({
              type: "function" as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema,
              },
            })),
          }
        : {}),
    });

    const choice = response.choices[0];
    const message = choice.message;
    const text = message.content ?? "";
    const toolCalls: ToolCall[] = [];

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type === "function") {
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
          });
        }
      }
    }

    return { text, tool_calls: toolCalls };
  }

  private async chatOpenAICodexResponses(
    systemPrompt: string,
    messages: OpenAI.ChatCompletionMessageParam[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    const input = mapMessagesToResponsesInput(messages);
    const requestBody: any = {
      model: this.model,
      store: false,
      stream: false,
      instructions: systemPrompt,
      input,
      ...(tools?.length
        ? {
            tools: tools.map((t) => ({
              type: "function" as const,
              name: t.name,
              description: t.description,
              parameters: t.input_schema,
              strict: false,
            })),
            tool_choice: "auto" as const,
            parallel_tool_calls: true,
          }
        : {}),
    };

    const response = await this.openai!.responses.create(requestBody);

    let text = typeof response.output_text === "string" ? response.output_text : "";
    const toolCalls: ToolCall[] = [];
    const outputItems = Array.isArray(response.output) ? response.output : [];

    for (const item of outputItems) {
      if (!item || typeof item !== "object") continue;

      if ((item as { type?: unknown }).type === "function_call") {
        const call = item as {
          id?: string;
          call_id?: string;
          name?: string;
          arguments?: string;
        };
        if (!call.name) continue;
        toolCalls.push({
          id: call.call_id ?? call.id ?? `call_${toolCalls.length}`,
          name: call.name,
          input: safeJsonParseObject(call.arguments),
        });
        continue;
      }

      if ((item as { type?: unknown }).type === "message" && !text) {
        const message = item as {
          role?: string;
          content?: Array<{ type?: string; text?: string }>;
        };
        if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
        text = message.content
          .filter((c) => c?.type === "output_text" && typeof c.text === "string")
          .map((c) => c.text as string)
          .join("");
      }
    }

    return { text, tool_calls: toolCalls };
  }

  private async agentLoopOpenAI(
    systemPrompt: string,
    userPrompt: string,
    tools: ToolDefinition[],
    toolExecutor: ToolExecutor,
    priorHistory?: ConversationTurn[],
  ): Promise<{ text: string; newTurns: ConversationTurn[] }> {
    const MAX_ITERATIONS = 25;
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    // Prepend prior conversation history
    if (priorHistory?.length) {
      for (const turn of priorHistory) {
        messages.push({ role: "user", content: turn.userMessage });
        messages.push({ role: "assistant", content: turn.assistantResponse });
      }
    }

    messages.push({ role: "user", content: userPrompt });

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.chatOpenAI(systemPrompt, messages, tools);

      if (response.tool_calls.length === 0) {
        return {
          text: response.text,
          newTurns: [{ userMessage: userPrompt, assistantResponse: response.text }],
        };
      }

      // Build assistant message with tool calls
      const assistantMessage: OpenAI.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: response.text || null,
        tool_calls: response.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input),
          },
        })),
      };
      messages.push(assistantMessage);

      // Execute tools and append results
      for (const tc of response.tool_calls) {
        const result = await toolExecutor(tc);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }
    }

    // If we hit the limit, return whatever text we have
    const last = await this.chatOpenAI(systemPrompt, messages, []);
    const text = last.text || "(Agent reached maximum tool call iterations)";
    return {
      text,
      newTurns: [{ userMessage: userPrompt, assistantResponse: text }],
    };
  }
}

function extractOpenAIAccountId(token: string): string {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    ) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"];
    if (!auth || typeof auth !== "object") {
      throw new Error("No OpenAI auth claim");
    }
    const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
    if (!accountId || typeof accountId !== "string") {
      throw new Error("No account ID in token");
    }
    return accountId;
  } catch {
    throw new Error("Failed to extract accountId from token");
  }
}

function mapMessagesToResponsesInput(
  messages: OpenAI.ChatCompletionMessageParam[]
): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "user") {
      const text = contentToText(message.content);
      input.push({
        role: "user",
        content: [{ type: "input_text", text }],
      });
      continue;
    }

    if (message.role === "assistant") {
      const text = contentToText(message.content);
      if (text) {
        input.push({
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
      continue;
    }

    if (message.role === "tool") {
      const output = contentToText(message.content);
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output,
      });
    }
  }

  return input;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const typed = item as Record<string, unknown>;
    const text = typed.text;
    if (typeof text === "string" && text.length > 0) {
      parts.push(text);
    }
  }
  return parts.join("\n");
}

function safeJsonParseObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
