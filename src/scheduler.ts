import { Cron } from "croner";
import type { TaskRunner } from "./runner.js";
import type { CronTask } from "./config.js";
import type { Logger } from "./logger.js";

export interface SchedulerStatus {
  tasks: {
    name: string;
    schedule: string;
    nextRun: string | null;
    running: boolean;
  }[];
}

export class Scheduler {
  private jobs: Cron[] = [];
  private running = new Set<string>();
  private runner: TaskRunner;
  private tasks: Record<string, CronTask>;
  private logger: Logger;

  constructor(
    tasks: Record<string, CronTask>,
    runner: TaskRunner,
    logger: Logger
  ) {
    this.tasks = tasks;
    this.runner = runner;
    this.logger = logger;
  }

  start(): void {
    for (const [name, task] of Object.entries(this.tasks)) {
      this.logger.info(`Scheduling "${name}": ${task.schedule}`);

      const job = new Cron(task.schedule, async () => {
        if (this.running.has(name)) {
          this.logger.warn(`Skipping "${name}" — previous run still in progress`);
          return;
        }

        this.running.add(name);
        try {
          this.logger.info(`Cron firing: ${name}`);
          await this.runner.runTask({
            name,
            prompt: task.prompt,
            output: task.output,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          this.logger.error(`Cron task "${name}" failed: ${msg}`);
        } finally {
          this.running.delete(name);
        }
      });

      this.jobs.push(job);
    }

    this.logger.info(`Scheduler started with ${this.jobs.length} tasks`);
  }

  stop(): void {
    for (const job of this.jobs) {
      job.stop();
    }
    this.jobs = [];
    this.logger.info("Scheduler stopped");
  }

  getStatus(): SchedulerStatus {
    const taskEntries = Object.entries(this.tasks);
    return {
      tasks: taskEntries.map(([name, task], i) => ({
        name,
        schedule: task.schedule,
        nextRun: this.jobs[i]?.nextRun()?.toISOString() ?? null,
        running: this.running.has(name),
      })),
    };
  }
}
