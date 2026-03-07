import { readFile, writeFile, unlink } from "node:fs/promises";
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
import { WebhookServer } from "./webhooks/server.js";
import { createLogger, type Logger } from "./logger.js";
import { refreshOpenAIAccessToken } from "./oauth/openai.js";
import {
  loadOpenAICodexProfile,
  saveOpenAICodexProfile,
} from "./oauth/store.js";

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
  private webhookServer?: WebhookServer;

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

    // Refresh OpenAI OAuth access token when needed before creating the LLM client.
    if (provider === "openai_subscription") {
      const openaiTokenEnv = credEnvName ?? FALLBACK_ENV[provider];
      await this.syncOpenAIOAuthFromStore(env, openaiTokenEnv);
      await this.maybeRefreshOpenAIOAuthToken(env, openaiTokenEnv);
    }

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

    // Load modules (pass policy for allowlist enforcement)
    const modules = await loadModules(config, env, this.logger, config.policy, this.dir);
    this.logger.info(
      `Modules: ${modules.map((m) => m.name).join(", ") || "none"}`
    );

    // Create runner with policy and approval notifications
    this.runner = new TaskRunner(this.dir, llm, modules, this.logger, {
      policy: config.policy,
      onApprovalNeeded: (msg) => {
        this.logger.info(`Approval notification: ${msg.slice(0, 100)}`);
        for (const ch of this.channels) {
          ch.send(msg).catch((err) => {
            this.logger.error(`Failed to send approval notification via ${ch.name}: ${err}`);
          });
        }
      },
    });

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

    // Start webhook server if enabled
    if (env.WEBHOOK_ENABLED === "true" && env.NEYNAR_API_KEY && env.FARCASTER_FID) {
      const webhookPort = parseInt(env.WEBHOOK_PORT || "3456", 10);
      const watchedFids = env.WEBHOOK_WATCH_FIDS
        ? env.WEBHOOK_WATCH_FIDS.split(",").map((f) => parseInt(f.trim(), 10))
        : undefined;
      this.webhookServer = new WebhookServer({
        port: webhookPort,
        ownFid: parseInt(env.FARCASTER_FID, 10),
        neynarApiKey: env.NEYNAR_API_KEY,
        webhookSecret: env.NEYNAR_WEBHOOK_SECRET,
        watchedFids,
        logger: this.logger,
        onEvent: async (prompt) => {
          return this.runner!.runMessage(prompt, "webhook");
        },
      });
      await this.webhookServer.start();
      this.logger.info(`Webhook server started on port ${webhookPort}`);
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

    const moduleNames = modules.map((m) => m.name).join(", ") || "none";
    const channelNames = this.channels.map((c) => c.name).join(", ") || "none";
    const cronCount = Object.keys(config.cron).length;
    const webhookStatus = this.webhookServer
      ? `port ${env.WEBHOOK_PORT || "3456"}`
      : "off";

    console.log(`
    \x1b[38;2;94;255;164m  _____     ____\x1b[0m
    \x1b[38;2;94;255;164m /      \\  |  o |\x1b[0m
    \x1b[38;2;94;255;164m|        |/ ___\\|\x1b[0m
    \x1b[38;2;94;255;164m|_________/\x1b[0m
    \x1b[38;2;94;255;164m|_|_| |_|_|\x1b[0m

  \x1b[1mPID ${process.pid}\x1b[0m — swimming along

  Modules     ${moduleNames}
  Cron tasks  ${cronCount}
  Channels    ${channelNames}
  Webhooks    ${webhookStatus}

  \x1b[2mfreeturtle send "message"  — talk to your CEO\x1b[0m
  \x1b[2mfreeturtle start --chat   — interactive mode\x1b[0m
  \x1b[2mfreeturtle status         — check on things\x1b[0m
  \x1b[2mCtrl+C                    — stop\x1b[0m
`);
  }

  async stop(): Promise<void> {
    this.scheduler?.stop();
    this.heartbeat?.stop();
    for (const ch of this.channels) {
      await ch.stop();
    }
    if (this.webhookServer) await this.webhookServer.stop();
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
      try {
        const response = await this.runner.runMessage(message, "ipc");
        return response;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        this.logger.error(`IPC send failed: ${msg}`);
        return `Error: ${msg}`;
      }
    }

    if (command.startsWith("approve ")) {
      const id = command.slice(8).trim();
      if (!this.runner) return "Error: runner not initialized";
      try {
        const req = await this.runner.getApprovalManager().approve(id, "ipc");
        return JSON.stringify(req, null, 2);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : "unknown"}`;
      }
    }

    if (command.startsWith("reject ")) {
      const parts = command.slice(7).trim();
      const spaceIdx = parts.indexOf(" ");
      const id = spaceIdx > -1 ? parts.slice(0, spaceIdx) : parts;
      const reason = spaceIdx > -1 ? parts.slice(spaceIdx + 1) : undefined;
      if (!this.runner) return "Error: runner not initialized";
      try {
        const req = await this.runner.getApprovalManager().reject(id, reason, "ipc");
        return JSON.stringify(req, null, 2);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : "unknown"}`;
      }
    }

    if (command === "approvals") {
      if (!this.runner) return "Error: runner not initialized";
      try {
        const pending = await this.runner.getApprovalManager().list("pending");
        if (pending.length === 0) return "No pending approvals.";
        return JSON.stringify(pending, null, 2);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : "unknown"}`;
      }
    }

    if (command === "stop") {
      void this.stop().then(() => process.exit(0));
      return "Stopping...";
    }

    return `Unknown command: ${command}`;
  }

  private async maybeRefreshOpenAIOAuthToken(
    env: Record<string, string>,
    tokenEnvName: string
  ): Promise<void> {
    const currentToken = env[tokenEnvName];
    const refreshToken = env.OPENAI_OAUTH_REFRESH_TOKEN;
    const expiresAtRaw = env.OPENAI_OAUTH_EXPIRES_AT;
    const now = Math.floor(Date.now() / 1000);
    const refreshWindowSec = 5 * 60;

    const expiresAt =
      expiresAtRaw && /^\d+$/.test(expiresAtRaw)
        ? parseInt(expiresAtRaw, 10)
        : null;
    const needsRefresh =
      !currentToken ||
      (typeof expiresAt === "number" && expiresAt - now <= refreshWindowSec);

    if (!needsRefresh) return;
    if (!refreshToken) {
      if (!currentToken) {
        this.logger.warn(
          "OpenAI subscription token missing and OPENAI_OAUTH_REFRESH_TOKEN is not set."
        );
      }
      return;
    }

    this.logger.info("Refreshing OpenAI OAuth access token");
    const refreshed = await refreshOpenAIAccessToken(refreshToken);

    env[tokenEnvName] = refreshed.accessToken;
    if (refreshed.refreshToken) {
      env.OPENAI_OAUTH_REFRESH_TOKEN = refreshed.refreshToken;
    }
    if (typeof refreshed.expiresAt === "number") {
      env.OPENAI_OAUTH_EXPIRES_AT = String(refreshed.expiresAt);
    }

    await this.persistEnvVars({
      [tokenEnvName]: env[tokenEnvName],
      ...(env.OPENAI_OAUTH_REFRESH_TOKEN
        ? { OPENAI_OAUTH_REFRESH_TOKEN: env.OPENAI_OAUTH_REFRESH_TOKEN }
        : {}),
      ...(env.OPENAI_OAUTH_EXPIRES_AT
        ? { OPENAI_OAUTH_EXPIRES_AT: env.OPENAI_OAUTH_EXPIRES_AT }
        : {}),
    });

    const existingProfile = await loadOpenAICodexProfile(this.dir);
    await saveOpenAICodexProfile(this.dir, {
      access_token: env[tokenEnvName],
      ...(env.OPENAI_OAUTH_REFRESH_TOKEN
        ? { refresh_token: env.OPENAI_OAUTH_REFRESH_TOKEN }
        : {}),
      ...(env.OPENAI_OAUTH_EXPIRES_AT && /^\d+$/.test(env.OPENAI_OAUTH_EXPIRES_AT)
        ? { expires_at: parseInt(env.OPENAI_OAUTH_EXPIRES_AT, 10) }
        : {}),
      ...(existingProfile?.account_id
        ? { account_id: existingProfile.account_id }
        : {}),
    });
  }

  private async syncOpenAIOAuthFromStore(
    env: Record<string, string>,
    tokenEnvName: string
  ): Promise<void> {
    const stored = await loadOpenAICodexProfile(this.dir);
    if (!stored?.access_token) return;

    env[tokenEnvName] = stored.access_token;
    if (stored.refresh_token) {
      env.OPENAI_OAUTH_REFRESH_TOKEN = stored.refresh_token;
    }
    if (typeof stored.expires_at === "number") {
      env.OPENAI_OAUTH_EXPIRES_AT = String(stored.expires_at);
    }
    if (stored.account_id) {
      env.OPENAI_ACCOUNT_ID = stored.account_id;
    }
  }

  private async persistEnvVars(vars: Record<string, string>): Promise<void> {
    const envPath = join(this.dir, ".env");
    let existing = "";
    try {
      existing = await readFile(envPath, "utf-8");
    } catch {
      // no existing .env
    }
    await writeFile(envPath, mergeEnv(existing, vars), "utf-8");
  }
}

function mergeEnv(
  existing: string,
  vars: Record<string, string>
): string {
  const lines = existing ? existing.split("\n") : [];
  const remaining = { ...vars };

  const updated = lines.map((line) => {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match && match[1] in remaining) {
      const key = match[1];
      const val = remaining[key];
      delete remaining[key];
      return `${key}=${val}`;
    }
    return line;
  });

  for (const [key, val] of Object.entries(remaining)) {
    updated.push(`${key}=${val}`);
  }

  const result = updated.join("\n");
  return result.endsWith("\n") ? result : result + "\n";
}
