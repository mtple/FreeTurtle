import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { join, dirname, normalize, resolve } from "node:path";
import type { FreeTurtleModule, ToolDefinition } from "../types.js";
import type { PolicyConfig } from "../../policy.js";
import { workspaceTools } from "./tools.js";

/** Files that require founder approval to modify */
const PROTECTED_FILES = ["soul.md", "config.md", ".env"];

export class WorkspaceModule implements FreeTurtleModule {
  name = "workspace";
  description = "Read and write files in your own workspace — modify your soul, config, memory, and notes.";

  private dir!: string;

  async initialize(
    config: Record<string, unknown>,
    _env: Record<string, string>,
    _options?: { policy?: PolicyConfig },
  ): Promise<void> {
    this.dir = config._workspaceDir as string;
    if (!this.dir) {
      throw new Error("Workspace module requires _workspaceDir");
    }
  }

  getTools(): ToolDefinition[] {
    return workspaceTools;
  }

  async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case "read_file":
        return this.readFile(input.path as string);
      case "write_file":
        return this.writeFile(input.path as string, input.content as string);
      case "edit_file":
        return this.editFile(
          input.path as string,
          input.old_text as string,
          input.new_text as string,
        );
      case "list_files":
        return this.listFiles((input.path as string) || ".");
      case "reload_config":
        return this.reloadConfig();
      case "restart_daemon":
        return this.restartDaemon();
      default:
        throw new Error(`Unknown workspace tool: ${name}`);
    }
  }

  /** Resolve a relative path, ensuring it stays within the workspace */
  private safePath(relativePath: string): string {
    const normalized = normalize(relativePath);
    if (normalized.startsWith("..") || normalized.startsWith("/")) {
      throw new Error(`Path "${relativePath}" is not allowed — must be relative to workspace`);
    }
    const full = resolve(this.dir, normalized);
    if (!full.startsWith(this.dir)) {
      throw new Error(`Path "${relativePath}" escapes the workspace`);
    }
    return full;
  }

  private async readFile(path: string): Promise<string> {
    const full = this.safePath(path);
    try {
      const content = await readFile(full, "utf-8");
      return content;
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        return `Error: File not found: ${path}`;
      }
      throw err;
    }
  }

  private async writeFile(path: string, content: string): Promise<string> {
    const full = this.safePath(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf-8");
    return `Written: ${path} (${content.length} chars)`;
  }

  private async editFile(path: string, oldText: string, newText: string): Promise<string> {
    const full = this.safePath(path);
    let content: string;
    try {
      content = await readFile(full, "utf-8");
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        return `Error: File not found: ${path}`;
      }
      throw err;
    }

    if (!content.includes(oldText)) {
      return `Error: Could not find the text to replace in ${path}`;
    }

    const updated = content.replace(oldText, newText);
    await writeFile(full, updated, "utf-8");
    return `Edited: ${path}`;
  }

  private async restartDaemon(): Promise<string> {
    try {
      const { rpcCall } = await import("../../rpc/client.js");
      await rpcCall("restart");
      return "Restart initiated. The daemon will shut down and a new process will start. You may be briefly unavailable.";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Restart failed: ${msg}`;
    }
  }

  private async reloadConfig(): Promise<string> {
    try {
      const { rpcCall } = await import("../../rpc/client.js");
      const result = await rpcCall("reload") as { reloaded: string[] };
      if (result.reloaded.length > 0) {
        return `Config reloaded. Updated: ${result.reloaded.join(", ")}. Changes are now active.`;
      }
      return "Config reloaded. No changes detected (or changes don't require reload).";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Config reload failed: ${msg}`;
    }
  }

  private async listFiles(path: string): Promise<string> {
    const full = this.safePath(path);
    try {
      const entries = await readdir(full);
      const results: string[] = [];
      for (const entry of entries) {
        // Skip hidden files except .env
        if (entry.startsWith(".") && entry !== ".env") continue;
        try {
          const info = await stat(join(full, entry));
          results.push(info.isDirectory() ? `${entry}/` : entry);
        } catch {
          results.push(entry);
        }
      }
      return results.length > 0 ? results.join("\n") : "(empty directory)";
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        return `Error: Directory not found: ${path}`;
      }
      throw err;
    }
  }
}

/** Check if a workspace file path is protected (requires approval) */
export function isProtectedWorkspacePath(path: string): boolean {
  const normalized = normalize(path);
  return PROTECTED_FILES.some(
    (f) => normalized === f || normalized.endsWith(`/${f}`),
  );
}
