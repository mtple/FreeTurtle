#!/usr/bin/env node

import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { runInit } from "../src/cli/init.js";
import { runStart } from "../src/cli/start.js";
import { runStatus } from "../src/cli/status.js";
import { runSend } from "../src/cli/send.js";
import { runSetup } from "../src/setup.js";
import { connectFarcaster } from "../src/cli/connect-farcaster.js";
import { runInstallService } from "../src/cli/install-service.js";
import { runUpdate } from "../src/cli/update.js";
import {
  runApprove,
  runReject,
  runListApprovals,
} from "../src/cli/approvals.js";

const DEFAULT_DIR = join(homedir(), ".freeturtle");

const program = new Command();

program
  .name("freeturtle")
  .description(
    "An open-source framework for deploying autonomous AI CEOs that run onchain businesses."
  )
  .version("0.1.0");

program
  .command("hello")
  .description("Verify the CLI is working")
  .action(() => {
    console.log("FreeTurtle v0.1");
  });

program
  .command("init")
  .description("Set up a new AI CEO")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    await runInit(opts.dir);
  });

program
  .command("setup")
  .description("Configure your LLM provider and API key")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    await runSetup(opts.dir);
  });

program
  .command("start")
  .description("Start the FreeTurtle daemon")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .option("--chat", "Open interactive terminal chat", false)
  .action(async (opts) => {
    await runStart(opts.dir, { chat: opts.chat });
  });

program
  .command("status")
  .description("Show daemon status")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    try {
      await runStatus(opts.dir);
    } catch (err) {
      if (err instanceof Error) console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("send <message>")
  .description("Send a message to the running CEO")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (message, opts) => {
    await runSend(opts.dir, message);
  });

program
  .command("update")
  .description("Update FreeTurtle to the latest version")
  .action(async () => {
    await runUpdate();
  });

program
  .command("install-service")
  .description("Install FreeTurtle as a systemd user service (Linux)")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    await runInstallService(opts.dir);
  });

program
  .command("approve <id>")
  .description("Approve a pending action")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (id, opts) => {
    await runApprove(opts.dir, id);
  });

program
  .command("reject <id>")
  .description("Reject a pending action")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .option("--reason <reason>", "Rejection reason")
  .action(async (id, opts) => {
    await runReject(opts.dir, id, opts.reason);
  });

program
  .command("approvals")
  .description("List pending approval requests")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    await runListApprovals(opts.dir);
  });

const connect = program
  .command("connect")
  .description("Connect external services");

connect
  .command("farcaster")
  .description("Set up Farcaster signer with QR code approval")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (opts) => {
    await connectFarcaster(opts.dir);
  });

program.parse();
