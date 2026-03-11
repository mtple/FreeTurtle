import { Bot } from "grammy";
import type { Channel, MessageImage } from "./types.js";

const TYPING_INTERVAL_MS = 3_000; // Telegram typing indicator expires after 5s
const TYPING_TTL_MS = 120_000; // Safety: stop typing after 2 min max

export class TelegramChannel implements Channel {
  name = "telegram";
  private bot: Bot;
  private ownerId: number;

  constructor(token: string, ownerId: number) {
    this.bot = new Bot(token);
    this.ownerId = ownerId;
  }

  /** Start a typing indicator loop. Returns a stop function. */
  private startTyping(chatId: number): () => void {
    let stopped = false;

    const sendTyping = () => {
      if (stopped) return;
      this.bot.api.sendChatAction(chatId, "typing").catch(() => {});
    };

    // Send immediately, then every 3s
    sendTyping();
    const interval = setInterval(sendTyping, TYPING_INTERVAL_MS);

    // Safety TTL — never type forever
    const ttl = setTimeout(() => {
      stopped = true;
      clearInterval(interval);
    }, TYPING_TTL_MS);

    return () => {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      clearTimeout(ttl);
    };
  }

  async start(onMessage: (text: string, images?: MessageImage[]) => Promise<string>): Promise<void> {
    // Handle photo messages
    this.bot.on("message:photo", async (ctx) => {
      const senderId = ctx.from?.id;
      if (senderId !== this.ownerId) {
        await ctx.reply("Sorry, I only talk to my founder.");
        return;
      }

      const stopTyping = this.startTyping(ctx.chat.id);
      try {
        // Get the largest photo (last in array)
        const photos = ctx.message.photo;
        const largest = photos[photos.length - 1];
        const file = await ctx.api.getFile(largest.file_id);

        // Download the file as a buffer
        const url = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to download photo: ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const base64 = buffer.toString("base64");

        // Determine media type from file extension
        const ext = file.file_path?.split(".").pop()?.toLowerCase() ?? "jpg";
        const mimeMap: Record<string, string> = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          gif: "image/gif",
          webp: "image/webp",
        };
        const mediaType = mimeMap[ext] ?? "image/jpeg";

        const caption = ctx.message.caption ?? "What's in this image?";
        const images: MessageImage[] = [{ data: base64, mediaType }];

        const response = await onMessage(caption, images);
        stopTyping();
        await ctx.reply(response);
      } catch (err) {
        stopTyping();
        const msg = err instanceof Error ? err.message : "Unknown error";
        await ctx.reply(`Error: ${msg}`);
      }
    });

    // Handle text messages
    this.bot.on("message:text", async (ctx) => {
      const senderId = ctx.from?.id;
      if (senderId !== this.ownerId) {
        await ctx.reply("Sorry, I only talk to my founder.");
        return;
      }

      const text = ctx.message.text;
      const stopTyping = this.startTyping(ctx.chat.id);
      try {
        const response = await onMessage(text);
        stopTyping();
        await ctx.reply(response);
      } catch (err) {
        stopTyping();
        const msg = err instanceof Error ? err.message : "Unknown error";
        await ctx.reply(`Error: ${msg}`);
      }
    });

    this.bot.catch((err) => {
      console.error(`[telegram] ${err.message}`);
    });

    this.bot.start().catch((err) => {
      console.error(`[telegram] Failed to start: ${err.message}`);
    });
  }

  async send(text: string): Promise<void> {
    await this.bot.api.sendMessage(this.ownerId, text);
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }
}
