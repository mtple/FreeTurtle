import type { TaskRunner } from "./runner.js";
import type { Logger } from "./logger.js";

export class Heartbeat {
  private interval: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private runner: TaskRunner;
  private logger: Logger;
  private onAlert?: (message: string) => void;
  private running = false;

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

    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error(`Heartbeat tick error: ${err instanceof Error ? err.message : err}`);
      });
    }, this.interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
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
          "This is a scheduled heartbeat check. Review your heartbeat checklist. " +
          "If everything looks fine, respond with exactly HEARTBEAT_OK. " +
          "If something needs attention, describe what you found.",
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
    }
  }
}
