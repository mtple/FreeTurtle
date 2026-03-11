import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { FreeTurtleModule, ToolDefinition } from "../types.js";

// --- Constants (aligned with OpenClaw defaults) ---
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const MAX_TIMEOUT_MS = 1_800_000; // 30 minutes
const MAX_OUTPUT_CHARS = 200_000;
const TAIL_CHARS = 2_000;
const JOB_TTL_MS = 1_800_000; // 30 min — prune finished sessions
const SWEEPER_INTERVAL_MS = 300_000; // 5 min

// --- Session registry ---
interface Session {
  id: string;
  command: string;
  cwd?: string;
  pid?: number;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  process?: ChildProcess;
}

const sessions = new Map<string, Session>();

// Sweeper to prune old finished sessions
let sweeperStarted = false;
function ensureSweeper() {
  if (sweeperStarted) return;
  sweeperStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (s.finishedAt && now - s.finishedAt > JOB_TTL_MS) {
        sessions.delete(id);
      }
    }
  }, SWEEPER_INTERVAL_MS).unref();
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const head = text.slice(0, MAX_OUTPUT_CHARS - TAIL_CHARS - 50);
  const tail = text.slice(-TAIL_CHARS);
  return `${head}\n\n... (truncated ${text.length - MAX_OUTPUT_CHARS + 50} chars) ...\n\n${tail}`;
}

// --- Tool definitions ---
const TOOLS: ToolDefinition[] = [
  {
    name: "run_command",
    description:
      "Execute a shell command on the server. Use for installing packages, running scripts, checking system status, or any CLI operation. Set background=true for long-running commands, then use manage_process to check on them.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        working_directory: {
          type: "string",
          description: "Working directory. Defaults to home directory.",
        },
        timeout: {
          type: "number",
          description:
            "Timeout in seconds. Default 300 (5 min), max 1800 (30 min).",
        },
        background: {
          type: "boolean",
          description:
            "Run in background and return immediately with a session ID. Use manage_process to check output later.",
        },
        env: {
          type: "object",
          description:
            "Environment variable overrides (key-value pairs merged with system env).",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "manage_process",
    description:
      "Manage background command sessions. Actions: list (show all sessions), poll (get new output from a session), write (send stdin to a session), kill (terminate a session).",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "poll", "write", "kill"],
          description: "Action to perform",
        },
        session_id: {
          type: "string",
          description: "Session ID (required for poll, write, kill)",
        },
        data: {
          type: "string",
          description: "Data to write to stdin (for write action)",
        },
      },
      required: ["action"],
    },
  },
];

// --- Blocked env vars (security) ---
const BLOCKED_ENV_KEYS = new Set([
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONHOME",
  "PYTHONPATH",
  "BASH_ENV",
  "ENV",
  "SHELL",
  "SHELLOPTS",
  "IFS",
  "HOME",
  "PATH",
]);
const BLOCKED_ENV_PREFIXES = ["DYLD_", "LD_", "BASH_FUNC_"];

function sanitizeEnv(
  overrides: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!overrides) return undefined;
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(overrides)) {
    if (BLOCKED_ENV_KEYS.has(key)) continue;
    if (BLOCKED_ENV_PREFIXES.some((p) => key.startsWith(p))) continue;
    clean[key] = val;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

// --- Module ---
export class ShellModule implements FreeTurtleModule {
  name = "shell";
  description = "Execute shell commands and manage background processes";

  async initialize(
    _config: Record<string, unknown>,
    _env: Record<string, string>,
    _options?: { policy?: import("../../policy.js").PolicyConfig },
  ): Promise<void> {
    ensureSweeper();
  }

  getTools(): ToolDefinition[] {
    return TOOLS;
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    if (name === "run_command") return this.runCommand(input);
    if (name === "manage_process") return this.manageProcess(input);
    throw new Error(`Unknown tool: ${name}`);
  }

  private async runCommand(input: Record<string, unknown>): Promise<string> {
    const command = input.command as string;
    if (!command) return "Error: command is required";

    const cwd = (input.working_directory as string) || undefined;
    const background = (input.background as boolean) ?? false;
    const timeoutSec = Math.min(
      Math.max((input.timeout as number) ?? 300, 1),
      MAX_TIMEOUT_MS / 1000,
    );
    const timeoutMs = timeoutSec * 1000;
    const envOverrides = sanitizeEnv(input.env as Record<string, string>);

    const sessionId = randomUUID().slice(0, 8);
    const session: Session = {
      id: sessionId,
      command,
      cwd,
      startedAt: Date.now(),
      stdout: "",
      stderr: "",
    };
    sessions.set(sessionId, session);

    const env = envOverrides
      ? { ...process.env, ...envOverrides }
      : process.env;

    const child = spawn(command, {
      cwd,
      shell: "/bin/bash",
      env: env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    session.process = child;
    session.pid = child.pid;

    child.stdout?.on("data", (chunk: Buffer) => {
      session.stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      session.stderr += chunk.toString();
    });

    const onExit = new Promise<void>((resolve) => {
      child.on("close", (code) => {
        session.exitCode = code;
        session.finishedAt = Date.now();
        session.process = undefined;
        resolve();
      });
      child.on("error", (err) => {
        session.stderr += `\nSpawn error: ${err.message}`;
        session.exitCode = 1;
        session.finishedAt = Date.now();
        session.process = undefined;
        resolve();
      });
    });

    // Background mode — return immediately
    if (background) {
      // Set up timeout kill
      setTimeout(() => {
        if (!session.finishedAt) {
          child.kill("SIGTERM");
          setTimeout(() => {
            if (!session.finishedAt) child.kill("SIGKILL");
          }, 5000);
        }
      }, timeoutMs).unref();

      return JSON.stringify({
        status: "running",
        session_id: sessionId,
        pid: child.pid,
        command: command.slice(0, 200),
        message: `Command running in background. Use manage_process with action "poll" and session_id "${sessionId}" to check output.`,
      });
    }

    // Foreground mode — wait for completion or timeout
    const timer = setTimeout(() => {
      if (!session.finishedAt) {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!session.finishedAt) child.kill("SIGKILL");
        }, 5000);
      }
    }, timeoutMs);

    await onExit;
    clearTimeout(timer);

    const durationMs = (session.finishedAt ?? Date.now()) - session.startedAt;
    const timedOut =
      session.exitCode === null && durationMs >= timeoutMs - 100;

    const parts: string[] = [];
    if (session.stdout.trim()) {
      parts.push(truncateOutput(session.stdout.trim()));
    }
    if (session.stderr.trim()) {
      parts.push(`STDERR:\n${truncateOutput(session.stderr.trim())}`);
    }
    if (timedOut) {
      parts.push(`Command timed out after ${timeoutSec}s`);
    } else if (session.exitCode !== 0) {
      parts.push(`Exit code: ${session.exitCode}`);
    }

    // Clean up foreground sessions that completed quickly
    if (!background) {
      sessions.delete(sessionId);
    }

    return parts.join("\n\n") || "(no output)";
  }

  private async manageProcess(
    input: Record<string, unknown>,
  ): Promise<string> {
    const action = input.action as string;
    const sessionId = input.session_id as string;

    if (action === "list") {
      const list = [...sessions.values()].map((s) => ({
        session_id: s.id,
        command: s.command.slice(0, 200),
        pid: s.pid,
        running: !s.finishedAt,
        exit_code: s.exitCode,
        duration_ms: (s.finishedAt ?? Date.now()) - s.startedAt,
        stdout_tail: s.stdout.slice(-TAIL_CHARS),
        stderr_tail: s.stderr.slice(-TAIL_CHARS),
      }));
      if (list.length === 0) return "No active sessions.";
      return JSON.stringify(list, null, 2);
    }

    if (!sessionId) return "Error: session_id is required";
    const session = sessions.get(sessionId);
    if (!session) return `Error: session "${sessionId}" not found`;

    if (action === "poll") {
      const running = !session.finishedAt;
      return JSON.stringify({
        session_id: session.id,
        running,
        exit_code: session.exitCode,
        duration_ms: (session.finishedAt ?? Date.now()) - session.startedAt,
        stdout: truncateOutput(session.stdout),
        stderr: truncateOutput(session.stderr),
      });
    }

    if (action === "write") {
      const data = input.data as string;
      if (!data) return "Error: data is required for write action";
      if (!session.process?.stdin?.writable) {
        return "Error: session stdin is not writable (process may have exited)";
      }
      session.process.stdin.write(data);
      return `Wrote ${data.length} chars to session ${sessionId}`;
    }

    if (action === "kill") {
      if (session.finishedAt) {
        sessions.delete(sessionId);
        return `Session ${sessionId} was already finished (exit code ${session.exitCode}). Removed.`;
      }
      session.process?.kill("SIGTERM");
      // Force kill after 5s if needed
      setTimeout(() => {
        if (!session.finishedAt) session.process?.kill("SIGKILL");
      }, 5000);
      return `Sent SIGTERM to session ${sessionId} (PID ${session.pid})`;
    }

    return `Error: unknown action "${action}". Use: list, poll, write, kill`;
  }
}
