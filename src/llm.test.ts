import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { LLMClient } from "./llm.js";

describe("LLMClient Claude Code tool mapping", () => {
  it("splits multiline Claude OAuth system prompts into separate text blocks", async () => {
    const create = vi.fn(async () => ({
      content: [
        {
          type: "tool_use" as const,
          id: "tool_1",
          name: "Read",
          input: { path: "soul.md" },
        },
      ],
    }));
    const client = new LLMClient({
      provider: "claude_api",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
    }) as any;

    client.anthropicClaudeCodeOAuth = true;
    client.anthropic = { messages: { create } };

    const response = await client.chat(
      " First line \r\n\r\nSecond line\n  Third line  ",
      [{ role: "user", content: "Read soul.md" }] as Anthropic.MessageParam[],
      [
        {
          name: "read_file",
          description: "Read a workspace file",
          input_schema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    );

    expect(create).toHaveBeenCalledTimes(1);
    const payload = (create.mock.calls as unknown as Array<[unknown]>).at(0)?.[0] as {
      system?: Array<{ type: string; text: string }>;
      tools?: Array<{ name: string }>;
    };
    expect(payload.system).toEqual([
      { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
      { type: "text", text: "First line" },
      { type: "text", text: "Second line" },
      { type: "text", text: "Third line" },
    ]);
    expect(payload.tools?.[0]?.name).toBe("Read");
    expect(response.tool_calls).toEqual([
      {
        id: "tool_1",
        name: "read_file",
        input: { path: "soul.md" },
      },
    ]);
  });

  it("bankr provider routes to anthropic and sets default base URL", () => {
    const client = new LLMClient({
      provider: "bankr",
      model: "claude-sonnet-4.6",
      apiKey: "bk_test-key",
    }) as any;

    expect(client.provider).toBe("anthropic");
    expect(client.anthropic).toBeDefined();
    expect(client.openai).toBeUndefined();
    expect(client.anthropicClaudeCodeOAuth).toBe(false);
  });

  it("bankr provider respects custom baseUrl", () => {
    const client = new LLMClient({
      provider: "bankr",
      model: "claude-sonnet-4.6",
      apiKey: "bk_test-key",
      baseUrl: "https://custom.bankr.example.com",
    }) as any;

    expect(client.provider).toBe("anthropic");
    expect(client.anthropic).toBeDefined();
  });

  it("bankr provider throws without apiKey", () => {
    expect(() => new LLMClient({
      provider: "bankr",
      model: "claude-sonnet-4.6",
    })).toThrow("LLMClient missing required credential: apiKey");
  });

  it("keeps Claude-style tool names in Anthropic transcript while dispatching internal names", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use" as const,
            id: "tool_1",
            name: "Write",
            input: { path: "notes.md", content: "hello" },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: [{ type: "text" as const, text: "done" }],
      });

    const toolExecutor = vi.fn(async () => "ok");
    const client = new LLMClient({
      provider: "claude_api",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
    }) as any;

    client.anthropicClaudeCodeOAuth = true;
    client.anthropic = { messages: { create } };

    const result = await client.agentLoop(
      "System prompt",
      "Write notes.md",
      [
        {
          name: "write_file",
          description: "Write a workspace file",
          input_schema: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
          },
        },
      ],
      toolExecutor,
    );

    expect(toolExecutor).toHaveBeenCalledWith({
      id: "tool_1",
      name: "write_file",
      input: { path: "notes.md", content: "hello" },
    });

    const secondPayload = (create.mock.calls as unknown as Array<[unknown]>).at(1)?.[0] as {
      messages?: Array<{ role: string; content: Array<{ type: string; name?: string }> }>;
    };
    expect(secondPayload.messages?.[1]).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "Write",
          input: { path: "notes.md", content: "hello" },
        },
      ],
    });
    expect(result.text).toBe("done");
  });
});
