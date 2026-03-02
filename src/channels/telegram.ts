import { Bot } from "grammy";
import type { Channel } from "./types.js";

export class TelegramChannel implements Channel {
  name = "telegram";
  private bot: Bot;
  private ownerId: number;

  constructor(token: string, ownerId: number) {
    this.bot = new Bot(token);
    this.ownerId = ownerId;
  }

  async start(onMessage: (text: string) => Promise<string>): Promise<void> {
    this.bot.on("message:text", async (ctx) => {
      const senderId = ctx.from?.id;
      if (senderId !== this.ownerId) {
        await ctx.reply("Sorry, I only talk to my owner.");
        return;
      }

      const text = ctx.message.text;
      try {
        const response = await onMessage(text);
        await ctx.reply(response);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await ctx.reply(`Error: ${msg}`);
      }
    });

    this.bot.catch((err) => {
      console.error(`[telegram] Error: ${err.message}`);
    });

    this.bot.start();
  }

  async send(text: string): Promise<void> {
    await this.bot.api.sendMessage(this.ownerId, text);
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }
}
