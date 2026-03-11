#!/usr/bin/env node

// Suppress Node.js deprecation warnings from dependencies (e.g. punycode in @farcaster/hub-nodejs)
const origEmit = process.emit.bind(process) as typeof process.emit;
process.emit = ((event: string, ...args: unknown[]): boolean => {
  if (event === "warning" && args[0] instanceof Error && args[0].name === "DeprecationWarning") {
    return false;
  }
  return origEmit(event, ...args);
}) as typeof process.emit;

import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

const DEFAULT_DIR = join(homedir(), ".freeturtle");

const program = new Command();

program
  .name("freeturtle")
  .description(
    "An open-source framework for deploying autonomous AI CEOs that run onchain businesses."
  )
  .version("0.1.33");

program
  .command("hello")
  .description("Verify the CLI is working")
  .action(() => {
    console.log("  \x1b[38;2;94;255;164m _____     ____\x1b[0m");
    console.log("  \x1b[38;2;94;255;164m/      \\  |  o |\x1b[0m");
    console.log("  \x1b[38;2;94;255;164m|        |/ ___\\|\x1b[0m  FreeTurtle v0.1.33");
    console.log("  \x1b[38;2;94;255;164m|_________/\x1b[0m");
    console.log("  \x1b[38;2;94;255;164m|_|_| |_|_|\x1b[0m");
  });

program
  .command("init")
  .description("Set up a new AI CEO")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { runInit } = await import("../src/cli/init.js");
    await runInit(opts.dir);
  });

program
  .command("setup")
  .description("Configure your LLM provider and API key")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { runSetup } = await import("../src/setup.js");
    await runSetup(opts.dir);
  });

program
  .command("start")
  .description("Start the FreeTurtle daemon")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .option("--chat", "Open interactive terminal chat", false)
  .action(async (opts) => {
    const { runStart } = await import("../src/cli/start.js");
    await runStart(opts.dir, { chat: opts.chat });
  });

program
  .command("status")
  .description("Show daemon status")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    try {
      const { runStatus } = await import("../src/cli/status.js");
      await runStatus(opts.dir);
    } catch (err) {
      if (err instanceof Error) console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("health")
  .description("Check daemon health")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    try {
      const { rpcCall } = await import("../src/rpc/client.js");
      const health = (await rpcCall("health")) as {
        status: string; pid: number; uptime: number; memoryMB: number;
        runner: boolean; channels: string[]; heartbeat: boolean;
      };
      const color = health.status === "ok" ? "\x1b[32m" : "\x1b[31m";
      console.log(`\n  ${color}${health.status.toUpperCase()}\x1b[0m\n`);
      console.log(`  PID        ${health.pid}`);
      console.log(`  Uptime     ${Math.round(health.uptime)}s`);
      console.log(`  Memory     ${health.memoryMB} MB`);
      console.log(`  Runner     ${health.runner ? "ready" : "not initialized"}`);
      console.log(`  Channels   ${health.channels.join(", ") || "none"}`);
      console.log(`  Heartbeat  ${health.heartbeat ? "active" : "off"}`);
      console.log();
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("send <message>")
  .description("Send a message to the running CEO")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (message, opts) => {
    const { runSend } = await import("../src/cli/send.js");
    await runSend(opts.dir, message);
  });

program
  .command("stop")
  .description("Stop the FreeTurtle daemon")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { runStop } = await import("../src/cli/stop.js");
    await runStop(opts.dir);
  });

program
  .command("restart")
  .description("Restart the FreeTurtle daemon")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { runRestart } = await import("../src/cli/restart.js");
    await runRestart(opts.dir);
  });

program
  .command("update")
  .description("Update FreeTurtle to the latest version and restart daemon if running")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { runUpdate } = await import("../src/cli/update.js");
    await runUpdate(opts.dir);
  });

program
  .command("install-service")
  .description("Install FreeTurtle as a system service (launchd on macOS, systemd on Linux)")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { runInstallService } = await import("../src/cli/install-service.js");
    await runInstallService(opts.dir);
  });

program
  .command("approve <id>")
  .description("Approve a pending action")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (id, opts) => {
    const { runApprove } = await import("../src/cli/approvals.js");
    await runApprove(opts.dir, id);
  });

program
  .command("reject <id>")
  .description("Reject a pending action")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .option("--reason <reason>", "Rejection reason")
  .action(async (id, opts) => {
    const { runReject } = await import("../src/cli/approvals.js");
    await runReject(opts.dir, id, opts.reason);
  });

program
  .command("approvals")
  .description("List pending approval requests")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { runListApprovals } = await import("../src/cli/approvals.js");
    await runListApprovals(opts.dir);
  });

const connect = program
  .command("connect")
  .description("Connect external services (gmail, telegram, github, farcaster, database, onchain)");

connect
  .command("gmail")
  .description("Connect Gmail for reading and sending emails")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { connectGmail } = await import("../src/cli/connect-gmail.js");
    await connectGmail(opts.dir);
  });

connect
  .command("telegram")
  .description("Connect Telegram bot for messaging")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { connectTelegram } = await import("../src/cli/connect-telegram.js");
    await connectTelegram(opts.dir);
  });

connect
  .command("github")
  .description("Connect GitHub for repository access")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { connectGitHub } = await import("../src/cli/connect-github.js");
    await connectGitHub(opts.dir);
  });

connect
  .command("farcaster")
  .description("Set up Farcaster signer with QR code approval")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { connectFarcaster } = await import("../src/cli/connect-farcaster.js");
    await connectFarcaster(opts.dir);
  });

connect
  .command("database")
  .description("Connect a Postgres database")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { connectDatabase } = await import("../src/cli/connect-database.js");
    await connectDatabase(opts.dir);
  });

connect
  .command("onchain")
  .description("Connect an EVM RPC endpoint for onchain reads")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { connectOnchain } = await import("../src/cli/connect-onchain.js");
    await connectOnchain(opts.dir);
  });

program
  .command("skills")
  .description("List installed Agent Skills (OpenClaw / ClawHub compatible)")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { runSkillsList } = await import("../src/cli/skills.js");
    await runSkillsList(opts.dir);
  });

program
  .command("webhooks")
  .description("Set up Neynar webhooks for Farcaster mentions")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    const { runWebhooksSetup } = await import("../src/cli/webhooks.js");
    await runWebhooksSetup(opts.dir);
  });

program.parse();
