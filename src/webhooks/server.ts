import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import crypto from "node:crypto";
import type { Logger } from "../logger.js";

const NEYNAR_CAST_API = "https://api.neynar.com/v2/farcaster/cast";

interface WebhookCast {
  hash: string;
  text: string;
  parent_hash?: string;
  mentioned_profiles?: { fid: number }[];
  channel?: { id: string; name?: string };
  author: {
    fid: number;
    username: string;
    display_name?: string;
    experimental?: {
      neynar_user_score?: number;
    };
  };
}

export interface WebhookServerOptions {
  port: number;
  ownFid: number;
  neynarApiKey: string;
  webhookSecret?: string;
  onEvent: (prompt: string) => Promise<string>;
  logger: Logger;
  /** FIDs being watched for any casts */
  watchedFids?: number[];
  /** Minimum Neynar user score to process (default: 0.5) */
  minScore?: number;
  /** Max responses per user per hour (default: 5) */
  maxPerHour?: number;
}

export class WebhookServer {
  private server: Server | null = null;
  private options: WebhookServerOptions;
  private processedCasts = new Set<string>();
  private responseTracker = new Map<string, number[]>();
  private readonly MAX_PROCESSED = 1000;

  constructor(options: WebhookServerOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    return new Promise((resolve) => {
      this.server!.listen(this.options.port, () => {
        this.options.logger.info(
          `Webhook server listening on port ${this.options.port}`
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => resolve());
      this.server = null;
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
      return;
    }

    // Only accept POST /webhook
    if (req.method !== "POST" || req.url !== "/webhook") {
      res.writeHead(404);
      res.end();
      return;
    }

    const body = await this.readBody(req);

    // Verify signature
    if (this.options.webhookSecret) {
      const sig = req.headers["x-neynar-signature"] as string | undefined;
      if (!sig || !this.verifySignature(body, sig)) {
        this.options.logger.warn("Webhook: invalid signature");
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid signature" }));
        return;
      }
    }

    // Respond 200 immediately — process async
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

    // Parse and process
    try {
      const payload = JSON.parse(body.toString("utf-8")) as {
        type: string;
        data: WebhookCast;
      };
      await this.processCast(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      this.options.logger.error(`Webhook processing error: ${msg}`);
    }
  }

  private async processCast(payload: { type: string; data: WebhookCast }): Promise<void> {
    if (payload.type !== "cast.created" || !payload.data) return;

    const cast = payload.data;
    const authorFid = cast.author.fid;
    const authorUsername = cast.author.username || "unknown";
    const authorScore = cast.author.experimental?.neynar_user_score ?? null;
    const castText = cast.text || "";

    this.options.logger.info(
      `Webhook: @${authorUsername} (fid:${authorFid}): "${castText.substring(0, 80)}"`
    );

    // Skip own casts
    if (authorFid === this.options.ownFid) return;

    // Skip duplicates
    if (this.processedCasts.has(cast.hash)) return;
    this.processedCasts.add(cast.hash);
    if (this.processedCasts.size > this.MAX_PROCESSED) {
      const first = this.processedCasts.values().next().value;
      if (first) this.processedCasts.delete(first);
    }

    // Skip spam
    const minScore = this.options.minScore ?? 0.5;
    if (authorScore !== null && authorScore < minScore) {
      this.options.logger.info(`Webhook: skip spam (score: ${authorScore})`);
      return;
    }

    // Rate limit per user
    if (this.isRateLimited(authorFid)) {
      this.options.logger.info(`Webhook: rate limited @${authorUsername}`);
      return;
    }

    // Fetch parent context if this is a reply
    const parentContext = cast.parent_hash
      ? await this.fetchParentCast(cast.parent_hash)
      : null;

    // Determine event type
    const isMention = cast.mentioned_profiles?.some(
      (p) => p.fid === this.options.ownFid,
    );
    const isWatchedUser = this.options.watchedFids?.includes(authorFid);
    const channelName = cast.channel?.id;

    // Build prompt for the CEO
    const prompt = this.buildPrompt(cast, parentContext, {
      isMention: !!isMention,
      isWatchedUser: !!isWatchedUser,
      channelName,
    });

    // Route through the runner
    try {
      await this.options.onEvent(prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      this.options.logger.error(`Webhook: runner failed: ${msg}`);
    }
  }

  private buildPrompt(
    cast: WebhookCast,
    parentContext: { text: string; username: string } | null,
    context: { isMention: boolean; isWatchedUser: boolean; channelName?: string },
  ): string {
    const authorUsername = cast.author.username || "unknown";
    const castText = cast.text || "";
    const castHash = cast.hash;

    // Determine the event label and instructions
    let label: string;
    let instruction: string;

    if (context.isMention) {
      label = "FARCASTER MENTION";
      instruction = `Compose a reply and post it as a reply to cast hash ${castHash}.`;
    } else if (context.isWatchedUser) {
      label = `FARCASTER WATCHED USER @${authorUsername}`;
      instruction = `This is from a user you're watching. Decide if it's worth replying to. If so, reply to cast hash ${castHash}. If not, just acknowledge you saw it.`;
    } else if (context.channelName) {
      label = `FARCASTER CHANNEL /${context.channelName}`;
      instruction = `This was posted in a channel you're watching. Decide if it's relevant and worth replying to. If so, reply to cast hash ${castHash}. If not, just acknowledge you saw it.`;
    } else {
      label = "FARCASTER REPLY";
      instruction = `Compose a reply and post it as a reply to cast hash ${castHash}.`;
    }

    let prompt = `[${label} — use reply_to_cast tool with parent_hash "${castHash}" if replying]\n\n`;

    if (parentContext) {
      prompt += `Conversation context:\n`;
      prompt += `@${parentContext.username} said: "${parentContext.text}"\n\n`;
      prompt += `@${authorUsername} replied: "${castText}"\n\n`;
    } else {
      prompt += `@${authorUsername} said: "${castText}"\n\n`;
    }

    prompt += instruction;

    return prompt;
  }

  private async fetchParentCast(
    parentHash: string,
  ): Promise<{ text: string; username: string } | null> {
    try {
      const res = await fetch(
        `${NEYNAR_CAST_API}?identifier=${encodeURIComponent(parentHash)}&type=hash`,
        { headers: { "x-api-key": this.options.neynarApiKey } },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        cast?: { text: string; author?: { username: string } };
      };
      if (data.cast) {
        return {
          text: data.cast.text,
          username: data.cast.author?.username || "unknown",
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      this.options.logger.error(`Webhook: error fetching parent cast: ${msg}`);
    }
    return null;
  }

  private isRateLimited(authorFid: number): boolean {
    const now = Date.now();
    const key = String(authorFid);
    const cooldownMs = 60 * 60 * 1000;
    const max = this.options.maxPerHour ?? 5;

    if (!this.responseTracker.has(key)) this.responseTracker.set(key, []);
    const timestamps = this.responseTracker.get(key)!.filter(
      (t) => now - t < cooldownMs,
    );
    this.responseTracker.set(key, timestamps);

    if (timestamps.length >= max) return true;
    timestamps.push(now);
    return false;
  }

  private verifySignature(body: Buffer, signature: string): boolean {
    const hmac = crypto.createHmac("sha512", this.options.webhookSecret!);
    hmac.update(body);
    return signature === hmac.digest("hex");
  }

  private readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }
}
