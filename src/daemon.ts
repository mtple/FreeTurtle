import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import net from "node:net";
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "./config.js";
import { LLMClient, type LLMProvider } from "./llm.js";
import { loadModules } from "./modules/loader.js";
import { loadSkills } from "./skills/index.js";
import { TaskRunner } from "./runner.js";
import { Scheduler } from "./scheduler.js";
import { Heartbeat } from "./heartbeat.js";
import { TerminalChannel } from "./channels/terminal.js";
import { TelegramChannel } from "./channels/telegram.js";
import type { Channel } from "./channels/types.js";
import { WebhookServer } from "./webhooks/server.js";
import { RpcServer } from "./rpc/server.js";
import { DEFAULT_RPC_PORT } from "./rpc/protocol.js";
import { createLogger, type Logger } from "./logger.js";
import { refreshOpenAIAccessToken } from "./oauth/openai.js";
import {
  loadOpenAICodexProfile,
  saveOpenAICodexProfile,
} from "./oauth/store.js";

function isTransientNetworkError(err: Error): boolean {
  // AbortError from fetch() during shutdown
  if (err.name === "AbortError") return true;

  const msg = err.message.toLowerCase();
  const cause = err.cause instanceof Error ? err.cause.message.toLowerCase() : "";
  const patterns = [
    "econnreset",
    "etimedout",
    "enotfound",
    "econnrefused",
    "fetch failed",
    "socket hang up",
    "network error",
    "abort",
  ];
  return patterns.some((p) => msg.includes(p) || cause.includes(p));
}

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
  private llmClient?: LLMClient;
  private rpcServer?: RpcServer;
  private webhookServer?: WebhookServer;
  private shuttingDown = false;
  private messageQueue: Promise<string> = Promise.resolve("");
  private watchdogTimer?: ReturnType<typeof setInterval>;
  private currentConfig?: Awaited<ReturnType<typeof loadConfig>>;

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
    this.currentConfig = config;
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
    this.llmClient = llm;
    this.logger.info(`LLM: ${provider} / ${config.llm.model}`);

    // Load modules (pass policy for allowlist enforcement)
    const modules = await loadModules(config, env, this.logger, config.policy, this.dir);
    this.logger.info(
      `Modules: ${modules.map((m) => m.name).join(", ") || "none"}`
    );

    // Load Agent Skills (OpenClaw / ClawHub / Claude Code compatible)
    const skills = await loadSkills(this.dir, config.skills, this.logger);

    // Create runner with policy, skills, and approval notifications
    const sendToChannels = (msg: string) => {
      for (const ch of this.channels) {
        ch.send(msg).catch((err) => {
          this.logger.error(`Failed to send via ${ch.name}: ${err}`);
        });
      }
    };

    this.runner = new TaskRunner(this.dir, llm, modules, this.logger, {
      policy: config.policy,
      skills,
      onApprovalNeeded: (msg) => {
        this.logger.info(`Approval notification: ${msg.slice(0, 100)}`);
        sendToChannels(msg);
      },
      onFollowup: (msg) => {
        this.logger.info(`Followup: ${msg.slice(0, 100)}`);
        sendToChannels(msg);
      },
    });

    // Start scheduler
    if (Object.keys(config.cron).length > 0) {
      this.scheduler = new Scheduler(config.cron, this.runner, this.logger);
      this.scheduler.start();
    }

    // Start heartbeat — send alerts to all active channels
    if (config.heartbeat.enabled) {
      this.heartbeat = new Heartbeat(this.runner, this.logger, {
        intervalMs: config.heartbeat.interval_minutes * 60 * 1000,
        onAlert: (msg) => {
          for (const ch of this.channels) {
            ch.send(msg).catch((err) => {
              this.logger.error(`Failed to send alert via ${ch.name}: ${err}`);
            });
          }
        },
      });
      this.heartbeat.start();
    } else {
      this.logger.info("Heartbeat disabled in config");
    }

    // Start channels — serialize agent loop calls but let approval replies through immediately
    const tryApprovalIntercept = async (text: string): Promise<string | null> => {
      const lower = text.trim().toLowerCase();
      if (
        ["yes", "no", "approve", "reject", "y", "n"].includes(lower) &&
        this.runner
      ) {
        const pending = await this.runner.getApprovalManager().list("pending");
        this.logger.info(`Approval intercept: "${lower}", ${pending.length} pending`);
        if (pending.length > 0) {
          const latest = pending[0];
          const approved = ["yes", "approve", "y"].includes(lower);
          if (approved) {
            await this.runner.getApprovalManager().approve(latest.id, "channel");
            this.logger.info(`Approved ${latest.toolName} (${latest.id})`);
            return `Approved: ${latest.toolName}`;
          } else {
            await this.runner.getApprovalManager().reject(latest.id, undefined, "channel");
            this.logger.info(`Rejected ${latest.toolName} (${latest.id})`);
            return `Rejected: ${latest.toolName}`;
          }
        }
      }
      return null; // not an approval reply
    };

    const MESSAGE_TIMEOUT_MS = 180_000; // 3 minutes max per message

    const onMessage = async (text: string, images?: import("./channels/types.js").MessageImage[]): Promise<string> => {
      // Approval replies bypass the queue — they must resolve immediately
      // so the blocked agent loop can continue.
      const approvalResult = await tryApprovalIntercept(text);
      if (approvalResult !== null) return approvalResult;

      // Serialize agent loop calls so concurrent messages don't collide.
      this.messageQueue = this.messageQueue
        .catch(() => {}) // don't let a prior failure block the queue
        .then(() => {
          // Wrap runMessage with a timeout so a hung LLM call can't block
          // the queue forever.
          return Promise.race([
            this.runner!.runMessage(text, "channel", images),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error("Message timed out")), MESSAGE_TIMEOUT_MS),
            ),
          ]);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : "Unknown error";
          this.logger.error(`Message processing failed: ${msg}`);
          return `Sorry, something went wrong: ${msg}`;
        });
      return this.messageQueue;
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

    // Start RPC server (WebSocket on port 18820, like OpenClaw's gateway)
    const rpcPort = parseInt(env.RPC_PORT || String(DEFAULT_RPC_PORT), 10);
    this.rpcServer = new RpcServer(
      (method, params) => this.handleRpc(method, params),
      this.logger,
      rpcPort,
    );
    await this.rpcServer.start();

    // Signal handlers
    const shutdown = async () => {
      this.shuttingDown = true;
      this.logger.info("Shutting down...");
      await this.stop();
      process.exit(0);
    };
    process.on("SIGINT", () => { shutdown().catch((e) => this.logger.error(`Shutdown error: ${e}`)); });
    process.on("SIGTERM", () => { shutdown().catch((e) => this.logger.error(`Shutdown error: ${e}`)); });
    process.on("uncaughtException", (err) => {
      // Suppress all errors during shutdown (pending fetches, torn-down resources)
      if (this.shuttingDown) return;
      if (isTransientNetworkError(err)) {
        this.logger.warn(`Transient network error (ignored): ${err.message}`);
        return;
      }
      this.logger.error(`Uncaught exception: ${err.message}`);
    });
    process.on("unhandledRejection", (reason) => {
      if (this.shuttingDown) return;
      const err = reason instanceof Error ? reason : new Error(String(reason));
      if (isTransientNetworkError(err)) {
        this.logger.warn(`Transient network error (ignored): ${err.message}`);
        return;
      }
      this.logger.error(`Unhandled rejection: ${err.message}`);
    });

    this.logger.info("FreeTurtle is running");

    const moduleNames = modules.map((m) => m.name).join(", ") || "none";
    const skillNames = skills.length > 0 ? skills.map((s) => s.name).join(", ") : "none";
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
  Skills      ${skillNames}
  Cron tasks  ${cronCount}
  Channels    ${channelNames}
  Webhooks    ${webhookStatus}
  RPC         ws://127.0.0.1:${rpcPort}

  \x1b[2mfreeturtle send "message"  — talk to your CEO\x1b[0m
  \x1b[2mfreeturtle start --chat   — interactive mode\x1b[0m
  \x1b[2mfreeturtle status         — check on things\x1b[0m
  \x1b[2mfreeturtle health         — verify daemon is healthy\x1b[0m
  \x1b[2mCtrl+C                    — stop\x1b[0m
`);

    // systemd watchdog integration (Linux only)
    // Sends READY=1 on startup and WATCHDOG=1 every 30s via the NOTIFY_SOCKET.
    // WatchdogSec=90 in the unit file means 3 missed pings trigger a restart.
    if (process.platform === "linux" && process.env.NOTIFY_SOCKET) {
      try {
        const notifySocket = process.env.NOTIFY_SOCKET;
        const sendSdNotify = (msg: string) => {
          const conn = net.createConnection({ path: notifySocket }, () => {
            conn.end(msg);
          });
          conn.on("error", () => {}); // ignore errors
        };
        sendSdNotify("READY=1");
        this.watchdogTimer = setInterval(() => sendSdNotify("WATCHDOG=1"), 30_000);
        this.watchdogTimer.unref();
        this.logger.info("systemd watchdog active (30s interval)");
      } catch {
        this.logger.warn("Failed to initialize systemd watchdog");
      }
    }
  }

  async stop(): Promise<void> {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.scheduler?.stop();
    this.heartbeat?.stop();
    for (const ch of this.channels) {
      await ch.stop();
    }
    if (this.webhookServer) await this.webhookServer.stop();
    this.rpcServer?.stop();

    // Remove PID file
    try {
      await unlink(join(this.dir, "daemon.pid"));
    } catch {
      // ignore
    }

    this.logger.info("FreeTurtle stopped");
  }

  /**
   * Hot-reload: re-reads .env, config.md, modules, and restarts scheduler/heartbeat
   * without restarting the entire daemon process.
   */
  async reloadConfig(): Promise<{ reloaded: string[] }> {
    const reloaded: string[] = [];

    // Re-read .env into process.env so new tokens are picked up
    loadDotenv({ path: join(this.dir, ".env"), override: true });
    const env = process.env as Record<string, string>;

    const newConfig = await loadConfig(this.dir);
    const oldConfig = this.currentConfig;
    this.currentConfig = newConfig;

    // Reload modules if module config or env changed
    // (Always reload — cheap operation, ensures new env vars are picked up)
    const oldModules = JSON.stringify(oldConfig?.modules ?? {});
    const newModules = JSON.stringify(newConfig.modules);
    const modulesChanged = oldModules !== newModules;

    // Always reload modules to pick up new env vars (e.g. after `connect github`)
    try {
      const modules = await loadModules(newConfig, env, this.logger, newConfig.policy, this.dir);
      const skills = await loadSkills(this.dir, newConfig.skills, this.logger);

      const sendToChannels = (msg: string) => {
        for (const ch of this.channels) {
          ch.send(msg).catch((err) => {
            this.logger.error(`Failed to send via ${ch.name}: ${err}`);
          });
        }
      };

      this.runner = new TaskRunner(this.dir, this.llmClient!, modules, this.logger, {
        policy: newConfig.policy,
        skills,
        onApprovalNeeded: (msg) => {
          this.logger.info(`Approval notification: ${msg.slice(0, 100)}`);
          sendToChannels(msg);
        },
        onFollowup: (msg) => {
          this.logger.info(`Followup: ${msg.slice(0, 100)}`);
          sendToChannels(msg);
        },
      });
      reloaded.push("modules");
      this.logger.info(`Modules reloaded: ${modules.map((m) => m.name).join(", ")}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      this.logger.error(`Failed to reload modules: ${msg}`);
    }

    // Reload scheduler if cron changed
    const oldCron = JSON.stringify(oldConfig?.cron ?? {});
    const newCron = JSON.stringify(newConfig.cron);
    if (oldCron !== newCron) {
      this.scheduler?.stop();
      if (Object.keys(newConfig.cron).length > 0 && this.runner) {
        this.scheduler = new Scheduler(newConfig.cron, this.runner, this.logger);
        this.scheduler.start();
        reloaded.push("scheduler");
      } else {
        this.scheduler = undefined;
      }
    }

    // Reload heartbeat if changed
    const oldHb = JSON.stringify(oldConfig?.heartbeat ?? {});
    const newHb = JSON.stringify(newConfig.heartbeat);
    if (oldHb !== newHb) {
      this.heartbeat?.stop();
      if (newConfig.heartbeat.enabled && this.runner) {
        this.heartbeat = new Heartbeat(this.runner, this.logger, {
          intervalMs: newConfig.heartbeat.interval_minutes * 60 * 1000,
          onAlert: (msg) => {
            for (const ch of this.channels) {
              ch.send(msg).catch((err) => {
                this.logger.error(`Failed to send alert via ${ch.name}: ${err}`);
              });
            }
          },
        });
        this.heartbeat.start();
        reloaded.push("heartbeat");
      } else {
        this.heartbeat = undefined;
      }
    }

    if (reloaded.length > 0) {
      this.logger.info(`Config reloaded: ${reloaded.join(", ")}`);
    } else {
      this.logger.info("Config reloaded (no changes detected)");
    }

    return { reloaded };
  }

  private async handleRpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case "status":
        return {
          pid: process.pid,
          uptime: process.uptime(),
          scheduler: this.scheduler?.getStatus() ?? null,
          channels: this.channels.map((c) => c.name),
        };

      case "health":
        return {
          status: this.runner ? "ok" : "degraded",
          pid: process.pid,
          uptime: process.uptime(),
          memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
          runner: !!this.runner,
          channels: this.channels.map((c) => c.name),
          scheduler: this.scheduler?.getStatus() ?? null,
          heartbeat: !!this.heartbeat,
          timestamp: new Date().toISOString(),
        };

      case "send": {
        const message = params.message as string;
        if (!message) throw new Error("Missing 'message' param");
        if (!this.runner) throw new Error("Runner not initialized");
        return await this.runner.runMessage(message, "rpc");
      }

      case "approve": {
        const id = params.id as string;
        if (!id) throw new Error("Missing 'id' param");
        if (!this.runner) throw new Error("Runner not initialized");
        return await this.runner.getApprovalManager().approve(id, "rpc");
      }

      case "reject": {
        const id = params.id as string;
        if (!id) throw new Error("Missing 'id' param");
        if (!this.runner) throw new Error("Runner not initialized");
        return await this.runner.getApprovalManager().reject(
          id,
          params.reason as string | undefined,
          "rpc",
        );
      }

      case "approvals": {
        if (!this.runner) throw new Error("Runner not initialized");
        return await this.runner.getApprovalManager().list("pending");
      }

      case "reload":
        return await this.reloadConfig();

      case "restart":
        // Spawn a new daemon, then exit this one.
        // The new process is fully detached so it survives our exit.
        this.logger.info("Self-restart requested via RPC");
        void (async () => {
          try {
            const { startDaemonDelayed } = await import("./cli/daemon-utils.js");
            // Let the RPC response reach the caller
            await new Promise((r) => setTimeout(r, 500));
            // Schedule new daemon to start after a delay (gives old process time to fully exit)
            startDaemonDelayed(this.dir, 2);
            this.logger.info("New daemon scheduled, stopping old process");
            await this.stop();
            process.exit(0);
          } catch (err) {
            this.logger.error(`Self-restart failed: ${err}`);
            process.exit(1);
          }
        })();
        return { restarting: true };

      case "stop":
        this.stop().then(() => process.exit(0)).catch((e) => {
          this.logger.error(`Stop error: ${e}`);
          process.exit(1);
        });
        return { stopping: true };

      default:
        throw new Error(`Unknown method: ${method}`);
    }
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
