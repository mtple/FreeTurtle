import { Scheduler } from "./src/scheduler.js";
import { createLogger } from "./src/logger.js";
import type { TaskRunner } from "./src/runner.js";
import type { TaskConfig, TaskResult } from "./src/runner.js";

const logger = createLogger();
let runCount = 0;

// Mock runner that just logs and returns
const mockRunner = {
  async runTask(task: TaskConfig): Promise<TaskResult> {
    runCount++;
    const now = new Date().toISOString();
    console.log(`  [run #${runCount}] Task "${task.name}" fired at ${now}`);
    return {
      response: `Run ${runCount} complete`,
      toolsCalled: [],
      durationMs: 0,
    };
  },
} as unknown as TaskRunner;

const scheduler = new Scheduler(
  {
    test_task: {
      schedule: "*/5 * * * * *", // every 5 seconds
      prompt: "Say the current time",
    },
  },
  mockRunner,
  logger
);

console.log("Starting scheduler (will run for 18 seconds)...\n");
scheduler.start();

const status = scheduler.getStatus();
console.log("Status:", JSON.stringify(status, null, 2), "\n");

setTimeout(() => {
  scheduler.stop();
  console.log(`\nDone. Total runs: ${runCount}`);
  process.exit(0);
}, 18000);
