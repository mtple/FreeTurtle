import type { ToolDefinition, ToolCall, ToolExecutor } from "../../src/modules/types.js";

/**
 * Mock LLM client for testing the agent loop without real API calls.
 * Queue up responses that will be returned in order.
 */
export interface MockResponse {
  text: string;
  tool_calls?: ToolCall[];
}

export class MockLLMClient {
  private responses: MockResponse[] = [];
  calls: Array<{ system: string; messages: unknown[]; tools: ToolDefinition[] }> = [];

  /** Queue a response. First call gets first response, etc. */
  addResponse(response: MockResponse): void {
    this.responses.push(response);
  }

  /** Add a simple text response with no tool calls */
  addTextResponse(text: string): void {
    this.responses.push({ text, tool_calls: [] });
  }

  /** Add a response that calls a tool, followed by the final text response */
  addToolCall(name: string, input: Record<string, unknown>, finalText: string): void {
    this.responses.push({
      text: "",
      tool_calls: [{ id: `call_${this.responses.length}`, name, input }],
    });
    this.responses.push({ text: finalText, tool_calls: [] });
  }

  async agentLoop(
    systemPrompt: string,
    userPrompt: string,
    tools: ToolDefinition[],
    toolExecutor: ToolExecutor,
    priorHistory?: unknown[],
    images?: unknown[],
  ): Promise<{ text: string; newTurns: Array<{ userMessage: string; assistantResponse: string }> }> {
    const MAX_ITERATIONS = 25;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = this.responses.shift();
      if (!response) {
        throw new Error("MockLLMClient: no more queued responses");
      }

      this.calls.push({ system: systemPrompt, messages: [], tools });

      if (!response.tool_calls?.length) {
        return {
          text: response.text,
          newTurns: [{ userMessage: userPrompt, assistantResponse: response.text }],
        };
      }

      // Execute tools
      for (const tc of response.tool_calls) {
        await toolExecutor(tc);
      }
    }

    return {
      text: "(max iterations)",
      newTurns: [{ userMessage: userPrompt, assistantResponse: "(max iterations)" }],
    };
  }
}
