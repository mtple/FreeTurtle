import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error"];

export function createLogger(dir?: string): Logger {
  const logPath = dir ? join(dir, "workspace", "freeturtle.log") : null;
  let logFileReady = false;

  function formatLine(level: LogLevel, msg: string): string {
    const ts = new Date().toISOString();
    return `[${ts}] [${level.toUpperCase()}] ${msg}`;
  }

  async function writeToFile(line: string): Promise<void> {
    if (!logPath) return;
    if (!logFileReady) {
      await mkdir(dirname(logPath), { recursive: true });
      logFileReady = true;
    }
    await appendFile(logPath, line + "\n", "utf-8");
  }

  function log(level: LogLevel, msg: string): void {
    const minLevel: LogLevel = "debug";
    if (LEVEL_ORDER.indexOf(level) < LEVEL_ORDER.indexOf(minLevel)) return;

    const line = formatLine(level, msg);

    // Only print errors/warnings to stderr; all else goes to log file only
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    }

    writeToFile(line).catch(() => {
      // Silently ignore log file write failures
    });
  }

  return {
    debug: (msg: string) => log("debug", msg),
    info: (msg: string) => log("info", msg),
    warn: (msg: string) => log("warn", msg),
    error: (msg: string) => log("error", msg),
  };
}
