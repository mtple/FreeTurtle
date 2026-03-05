import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type {
  ToolDefinition,
  ToolCall,
  ToolExecutor,
} from "./modules/types.js";

export type LLMProvider =
  | "claude_api"
  | "claude_subscription"
  | "openai_api"
  | "openai_subscription"
  | "openrouter";

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
      this.anthropic = new Anthropic({
        authToken: options.oauthToken,
        baseURL: options.baseUrl,
      });
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
      this.openai = new OpenAI({
        // OpenAI SDK uses bearer auth via apiKey; OAuth access tokens also work here.
        apiKey: options.oauthToken,
        baseURL: options.baseUrl,
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
    toolExecutor: ToolExecutor
  ): Promise<string> {
    if (this.provider === "anthropic") {
      return this.agentLoopAnthropic(
        systemPrompt,
        userPrompt,
        tools,
        toolExecutor
      );
    }
    return this.agentLoopOpenAI(
      systemPrompt,
      userPrompt,
      tools,
      toolExecutor
    );
  }

  // --- Anthropic implementation ---

  private async chatAnthropic(
    systemPrompt: string,
    messages: Anthropic.MessageParam[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    const response = await this.anthropic!.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
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
    });

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
    toolExecutor: ToolExecutor
  ): Promise<string> {
    const MAX_ITERATIONS = 25;
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userPrompt },
    ];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.chatAnthropic(systemPrompt, messages, tools);

      if (response.tool_calls.length === 0) {
        return response.text;
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
    return last.text || "(Agent reached maximum tool call iterations)";
  }

  // --- OpenAI implementation ---

  private async chatOpenAI(
    systemPrompt: string,
    messages: OpenAI.ChatCompletionMessageParam[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
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

  private async agentLoopOpenAI(
    systemPrompt: string,
    userPrompt: string,
    tools: ToolDefinition[],
    toolExecutor: ToolExecutor
  ): Promise<string> {
    const MAX_ITERATIONS = 25;
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "user", content: userPrompt },
    ];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.chatOpenAI(systemPrompt, messages, tools);

      if (response.tool_calls.length === 0) {
        return response.text;
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
    return last.text || "(Agent reached maximum tool call iterations)";
  }
}
