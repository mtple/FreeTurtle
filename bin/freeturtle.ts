#!/usr/bin/env node

import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { runInit } from "../src/cli/init.js";
import { runStart } from "../src/cli/start.js";
import { runStatus } from "../src/cli/status.js";
import { runSend } from "../src/cli/send.js";
import { runSetup } from "../src/setup.js";

const DEFAULT_DIR = join(homedir(), ".freeturtle");

const program = new Command();

program
  .name("freeturtle")
  .description(
    "An open-source framework for deploying autonomous AI operators that run onchain businesses."
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
  .description("Set up a new AI operator")
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
  .action(async (opts) => {
    await runStart(opts.dir);
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
  .description("Send a message to the running operator")
  .option("--dir <path>", "Workspace directory", DEFAULT_DIR)
  .action(async (message, opts) => {
    await runSend(opts.dir, message);
  });

program.parse();
