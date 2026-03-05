import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import net from "node:net";
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "./config.js";
import { LLMClient, type LLMProvider } from "./llm.js";
import { loadModules } from "./modules/loader.js";
import { TaskRunner } from "./runner.js";
import { Scheduler } from "./scheduler.js";
import { Heartbeat } from "./heartbeat.js";
import { TerminalChannel } from "./channels/terminal.js";
import { TelegramChannel } from "./channels/telegram.js";
import type { Channel } from "./channels/types.js";
import { createLogger, type Logger } from "./logger.js";

export interface DaemonOptions {
  chat?: boolean;
}

export class FreeTurtleDaemon {
  private dir: string;
  private options: DaemonOptions;
  private logger: Logger;
  private scheduler?: Scheduler;
  private heartbeat?: Heartbeat;
  private channels: Channel[] = [];
  private runner?: TaskRunner;
  private ipcServer?: net.Server;

  constructor(dir: string, options: DaemonOptions = {}) {
    this.dir = dir;
    this.options = options;
    this.logger = createLogger(dir);
  }

  async start(): Promise<void> {
    // Load .env from workspace
    loadDotenv({ path: join(this.dir, ".env") });
    const env = process.env as Record<string, string>;

    // Load config
    const config = await loadConfig(this.dir);
    this.logger.info("Config loaded");

    // Create LLM client
    const provider = (config.llm.provider ?? "claude_api") as LLMProvider;
    const isOAuth = provider.endsWith("subscription");
    const credEnvName = isOAuth
      ? config.llm.oauth_token_env
      : config.llm.api_key_env;
    const credField = isOAuth ? "oauthToken" : "apiKey";

    // Try config-specified env var first, then fall back to well-known names
    const FALLBACK_ENV: Record<string, string> = {
      claude_api: "ANTHROPIC_API_KEY",
      claude_subscription: "ANTHROPIC_AUTH_TOKEN",
      openai_api: "OPENAI_API_KEY",
      openai_subscription: "OPENAI_OAUTH_TOKEN",
      openrouter: "OPENROUTER_API_KEY",
    };

    const credential =
      (credEnvName ? env[credEnvName] : undefined) ??
      env[FALLBACK_ENV[provider]];

    if (!credential) {
      throw new Error(
        `Missing credential: set ${credEnvName ?? FALLBACK_ENV[provider]} in .env`
      );
    }

    const llm = new LLMClient({
      provider,
      model: config.llm.model,
      [credField]: credential,
      baseUrl: config.llm.base_url,
    });
    this.logger.info(`LLM: ${provider} / ${config.llm.model}`);

    // Load modules
    const modules = await loadModules(config, env);
    this.logger.info(
      `Modules: ${modules.map((m) => m.name).join(", ") || "none"}`
    );

    // Create runner
    this.runner = new TaskRunner(this.dir, llm, modules, this.logger);

    // Start scheduler
    if (Object.keys(config.cron).length > 0) {
      this.scheduler = new Scheduler(config.cron, this.runner, this.logger);
      this.scheduler.start();
    }

    // Start heartbeat — send alerts to all active channels
    this.heartbeat = new Heartbeat(this.runner, this.logger, {
      onAlert: (msg) => {
        for (const ch of this.channels) {
          ch.send(msg).catch((err) => {
            this.logger.error(`Failed to send alert via ${ch.name}: ${err}`);
          });
        }
      },
    });
    this.heartbeat.start();

    // Start channels
    const onMessage = async (text: string) => {
      return this.runner!.runMessage(text, "channel");
    };

    if (this.options.chat) {
      const terminal = new TerminalChannel();
      this.channels.push(terminal);
      await terminal.start(onMessage);
    }

    if (config.channels.telegram?.enabled) {
      const token = env.TELEGRAM_BOT_TOKEN;
      const ownerId = env.TELEGRAM_OWNER_ID;
      if (token && ownerId) {
        const telegram = new TelegramChannel(token, parseInt(ownerId, 10));
        this.channels.push(telegram);
        await telegram.start(onMessage);
        this.logger.info("Telegram channel started");
      } else {
        this.logger.warn(
          "Telegram enabled but TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_ID missing"
        );
      }
    }

    // Write PID file
    const pidPath = join(this.dir, "daemon.pid");
    await writeFile(pidPath, String(process.pid), "utf-8");

    // Start IPC server
    await this.startIpc();

    // Signal handlers
    const shutdown = async () => {
      this.logger.info("Shutting down...");
      await this.stop();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
    process.on("uncaughtException", (err) => {
      this.logger.error(`Uncaught exception: ${err.message}`);
    });

    this.logger.info("FreeTurtle is running");

    const channelNames = this.channels.map((c) => c.name).join(", ") || "none";
    console.log(`
  FreeTurtle is running (PID ${process.pid})

  Modules:    ${modules.map((m) => m.name).join(", ") || "none"}
  Cron tasks: ${Object.keys(config.cron).length}
  Channels:   ${channelNames}

  Send messages:  freeturtle send "your message"
  Check status:   freeturtle status
  Interactive:    freeturtle start --chat
  Stop:           Ctrl+C
`);
  }

  async stop(): Promise<void> {
    this.scheduler?.stop();
    this.heartbeat?.stop();
    for (const ch of this.channels) {
      await ch.stop();
    }
    this.ipcServer?.close();

    // Remove PID file
    try {
      await unlink(join(this.dir, "daemon.pid"));
    } catch {
      // ignore
    }
    // Remove socket
    try {
      await unlink(join(this.dir, "daemon.sock"));
    } catch {
      // ignore
    }

    this.logger.info("FreeTurtle stopped");
  }

  private async startIpc(): Promise<void> {
    const sockPath = join(this.dir, "daemon.sock");

    // Remove stale socket
    try {
      await unlink(sockPath);
    } catch {
      // ignore
    }

    this.ipcServer = net.createServer((conn) => {
      let data = "";
      conn.on("data", (chunk) => {
        data += chunk.toString();
      });
      conn.on("end", () => {
        void this.handleIpc(data.trim()).then((response) => {
          conn.write(response);
          conn.end();
        });
      });
    });

    this.ipcServer.listen(sockPath);
    this.logger.info(`IPC listening on ${sockPath}`);
  }

  private async handleIpc(command: string): Promise<string> {
    if (command === "status") {
      const status = {
        pid: process.pid,
        uptime: process.uptime(),
        scheduler: this.scheduler?.getStatus() ?? null,
        channels: this.channels.map((c) => c.name),
      };
      return JSON.stringify(status, null, 2);
    }

    if (command.startsWith("send ")) {
      const message = command.slice(5);
      if (!this.runner) return "Error: runner not initialized";
      const response = await this.runner.runMessage(message, "ipc");
      return response;
    }

    if (command === "stop") {
      void this.stop().then(() => process.exit(0));
      return "Stopping...";
    }

    return `Unknown command: ${command}`;
  }
}
