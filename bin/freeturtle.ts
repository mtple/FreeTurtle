#!/usr/bin/env node

import { Command } from "commander";

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

program.parse();
