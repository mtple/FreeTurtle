#!/usr/bin/env node

import { Command } from "commander";
import { runSetup } from "../src/setup.js";

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
  .command("setup")
  .description("Configure your LLM provider and API key")
  .action(async () => {
    await runSetup(process.cwd());
  });

program.parse();
