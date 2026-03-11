import type { TaskRunner } from "./runner.js";
import type { Logger } from "./logger.js";

export class Heartbeat {
  private interval: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private runner: TaskRunner;
  private logger: Logger;
  private onAlert?: (message: string) => void;
  private running = false;
  private lastTickTimeMs = 0;

  constructor(
    runner: TaskRunner,
    logger: Logger,
    options?: {
      intervalMs?: number;
      onAlert?: (message: string) => void;
    }
  ) {
    this.runner = runner;
    this.logger = logger;
    this.interval = options?.intervalMs ?? 30 * 60 * 1000;
    this.onAlert = options?.onAlert;
  }

  start(): void {
    this.logger.info(
      `Heartbeat started (every ${Math.round(this.interval / 1000)}s)`
    );

    this.lastTickTimeMs = Date.now();

    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error(`Heartbeat tick error: ${err instanceof Error ? err.message : err}`);
      });
    }, this.interval);

    // Drift detection watchdog: checks every 10s for stale timers.
    // Node.js setTimeout/setInterval don't account for macOS sleep/wake,
    // so timers can stall permanently. This detects when the interval has
    // been missed (e.g. after system wake) and triggers an immediate tick.
    this.watchdogTimer = setInterval(() => {
      const elapsed = Date.now() - this.lastTickTimeMs;
      if (elapsed > this.interval + 5000) {
        this.logger.warn(
          `Heartbeat drift detected (${Math.round(elapsed / 1000)}s since last tick, expected ${Math.round(this.interval / 1000)}s). Triggering immediate heartbeat.`
        );
        this.tick().catch((err) => {
          this.logger.error(`Heartbeat drift recovery error: ${err instanceof Error ? err.message : err}`);
        });
      }
    }, 10_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.logger.info("Heartbeat stopped");
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn("Skipping heartbeat — previous tick still running");
      return;
    }

    this.running = true;
    try {
      this.logger.info("Heartbeat tick");
      const result = await this.runner.runTask({
        name: "heartbeat",
        prompt:
          "This is a scheduled heartbeat check. Review your heartbeat checklist if one exists. " +
          "Do NOT proactively check email, search Gmail, scan for task submissions, or make any tool calls " +
          "unless your heartbeat checklist explicitly instructs you to. " +
          "If there is no checklist or nothing needs attention, respond with exactly HEARTBEAT_OK. " +
          "Keep your response minimal to conserve resources.",
        isHeartbeat: true,
      });

      const text = result.response.trim();
      if (text === "HEARTBEAT_OK" || text.includes("HEARTBEAT_OK")) {
        this.logger.info("Heartbeat: all clear");
      } else {
        this.logger.info("Heartbeat: alert raised");
        this.onAlert?.(text);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      this.logger.error(`Heartbeat failed: ${msg}`);
    } finally {
      this.running = false;
      this.lastTickTimeMs = Date.now();
    }
  }
}
