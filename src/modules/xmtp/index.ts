import type { FreeTurtleModule, ToolDefinition } from "../types.js";

export class XmtpModule implements FreeTurtleModule {
  name = "xmtp";
  description = "XMTP messaging (not yet implemented).";

  async initialize(): Promise<void> {
    console.log("XMTP module not yet implemented");
  }

  getTools(): ToolDefinition[] {
    return [];
  }

  async executeTool(name: string): Promise<string> {
    throw new Error(`XMTP tool "${name}" not implemented`);
  }
}
