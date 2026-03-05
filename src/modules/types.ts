export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
}

export type ToolExecutor = (call: ToolCall) => Promise<string>;

export interface FreeTurtleModule {
  name: string;
  description: string;

  initialize(
    config: Record<string, unknown>,
    env: Record<string, string>,
    options?: { policy?: import("../policy.js").PolicyConfig },
  ): Promise<void>;

  getTools(): ToolDefinition[];

  executeTool(name: string, input: Record<string, unknown>): Promise<string>;
}
