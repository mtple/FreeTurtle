import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSoul } from "./soul.js";
import { readMemoryFile, writeMemoryFile } from "./memory.js";
import type { LLMClient } from "./llm.js";
import type {
  ToolDefinition,
  ToolCall,
  FreeTurtleModule,
} from "./modules/types.js";
import type { Logger } from "./logger.js";

export interface TaskConfig {
  name: string;
  prompt: string;
  output?: string;
  isHeartbeat?: boolean;
}

export interface TaskResult {
  response: string;
  toolsCalled: string[];
  durationMs: number;
}

export class TaskRunner {
  private dir: string;
  private llm: LLMClient;
  private modules: FreeTurtleModule[];
  private logger: Logger;

  constructor(
    dir: string,
    llm: LLMClient,
    modules: FreeTurtleModule[],
    logger: Logger
  ) {
    this.dir = dir;
    this.llm = llm;
    this.modules = modules;
    this.logger = logger;
  }

  async runTask(task: TaskConfig): Promise<TaskResult> {
    const start = Date.now();
    const toolsCalled: string[] = [];

    this.logger.info(`Running task: ${task.name}`);

    const systemPrompt = await this.buildSystemPrompt(task.isHeartbeat);
    const tools = this.collectTools();
    const executor = this.buildExecutor(toolsCalled);

    const response = await this.llm.agentLoop(
      systemPrompt,
      task.prompt,
      tools,
      executor
    );

    // Save output file if specified
    if (task.output) {
      const outputPath = task.output.replace(
        "{{date}}",
        new Date().toISOString().slice(0, 10)
      );
      const fullPath = join(this.dir, "workspace", outputPath);
      const { mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(fullPath), { recursive: true });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(fullPath, response, "utf-8");
      this.logger.info(`Saved output to ${outputPath}`);
    }

    // Save session notes
    const sessionNote = {
      task: task.name,
      timestamp: new Date().toISOString(),
      prompt: task.prompt,
      response: response.slice(0, 500),
      toolsCalled,
      durationMs: Date.now() - start,
    };
    const dateStr = new Date().toISOString().slice(0, 10);
    await writeMemoryFile(
      this.dir,
      `session-notes/${dateStr}-${task.name}.json`,
      JSON.stringify(sessionNote, null, 2)
    );

    const durationMs = Date.now() - start;
    this.logger.info(
      `Task ${task.name} completed in ${durationMs}ms (${toolsCalled.length} tool calls)`
    );

    return { response, toolsCalled, durationMs };
  }

  async runMessage(message: string, channel: string): Promise<string> {
    this.logger.info(`Message from ${channel}: ${message.slice(0, 100)}`);

    const systemPrompt = await this.buildSystemPrompt(false);
    const tools = this.collectTools();
    const toolsCalled: string[] = [];
    const executor = this.buildExecutor(toolsCalled);

    const response = await this.llm.agentLoop(
      systemPrompt,
      message,
      tools,
      executor
    );

    this.logger.info(
      `Replied to ${channel} (${toolsCalled.length} tool calls)`
    );
    return response;
  }

  private async buildSystemPrompt(isHeartbeat?: boolean): Promise<string> {
    const soul = await loadSoul(this.dir);

    // Load memory context
    const postingLog = await readMemoryFile(this.dir, "posting-log.json");
    const postQueue = await readMemoryFile(this.dir, "post-queue.json");

    let heartbeatChecklist: string | null = null;
    if (isHeartbeat) {
      try {
        heartbeatChecklist = await readFile(
          join(this.dir, "workspace", "HEARTBEAT.md"),
          "utf-8"
        );
      } catch {
        // no heartbeat file
      }
    }

    // Build recent posts section (last 20)
    let recentPosts = "No posts yet.";
    if (postingLog) {
      try {
        const entries = JSON.parse(postingLog) as unknown[];
        const recent = entries.slice(-20);
        recentPosts = JSON.stringify(recent, null, 2);
      } catch {
        recentPosts = "Error reading posting log.";
      }
    }

    let queueSection = "No queued posts.";
    if (postQueue) {
      try {
        const entries = JSON.parse(postQueue) as unknown[];
        if (entries.length > 0) {
          queueSection = JSON.stringify(entries, null, 2);
        }
      } catch {
        queueSection = "Error reading post queue.";
      }
    }

    const parts = [
      soul,
      "\n---\n",
      "## Current Context\n",
      "### Recent Posts\n" + recentPosts + "\n",
      "### Post Queue\n" + queueSection + "\n",
    ];

    if (heartbeatChecklist) {
      parts.push("### Heartbeat Checklist\n" + heartbeatChecklist + "\n");
    }

    parts.push(
      "---\n",
      "## Instructions\n",
      "- You are an autonomous AI operator. You act on behalf of the project described in your identity.",
      "- When you post, match the voice and style described in your identity.",
      "- Log important actions and observations.",
      "- If you are unsure about something, say so rather than guessing.",
      `- The current date and time is: ${new Date().toISOString()}`
    );

    return parts.join("\n");
  }

  private collectTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const mod of this.modules) {
      tools.push(...mod.getTools());
    }
    return tools;
  }

  private buildExecutor(toolsCalled: string[]) {
    return async (call: ToolCall): Promise<string> => {
      toolsCalled.push(call.name);
      this.logger.info(`Tool call: ${call.name}`);

      for (const mod of this.modules) {
        const toolNames = mod.getTools().map((t) => t.name);
        if (toolNames.includes(call.name)) {
          try {
            return await mod.executeTool(call.name, call.input);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : "Unknown error";
            this.logger.error(
              `Tool ${call.name} failed: ${msg}`
            );
            return `Error: ${msg}`;
          }
        }
      }

      this.logger.warn(`Unknown tool: ${call.name}`);
      return `Error: Unknown tool "${call.name}"`;
    };
  }
}
