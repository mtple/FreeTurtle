import * as readline from "node:readline";
import { stdin, stdout } from "node:process";
import type { Channel } from "./types.js";

export class TerminalChannel implements Channel {
  name = "terminal";
  private rl: readline.Interface | null = null;
  private processing = false;

  async start(onMessage: (text: string) => Promise<string>): Promise<void> {
    this.rl = readline.createInterface({ input: stdin, output: stdout });

    console.log("\n  Terminal channel active. Type a message or Ctrl+C to exit.\n");

    const prompt = () => {
      if (!this.rl) return;
      this.rl.question("you> ", async (input) => {
        const text = input.trim();
        if (!text) {
          prompt();
          return;
        }

        this.processing = true;
        try {
          const response = await onMessage(text);
          console.log(`\nceo> ${response}\n`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.log(`\n[error] ${msg}\n`);
        } finally {
          this.processing = false;
          prompt();
        }
      });
    };

    this.rl.on("close", () => {
      if (!this.processing) {
        console.log("\nGoodbye!");
        process.exit(0);
      }
    });

    prompt();
  }

  async send(text: string): Promise<void> {
    console.log(`\nceo> ${text}\n`);
  }

  async stop(): Promise<void> {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
