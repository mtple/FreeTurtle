import type { FreeTurtleModule, ToolDefinition } from "../types.js";
import type { PolicyConfig } from "../../policy.js";
import { assertFarcasterChannelAllowed } from "../../policy.js";
import { withRetry } from "../../reliability.js";
import { NeynarClient } from "./client.js";
import { farcasterTools } from "./tools.js";

export class FarcasterModule implements FreeTurtleModule {
  name = "farcaster";
  description = "Post and read casts on Farcaster via the Neynar API.";

  private client!: NeynarClient;
  private fid!: number;
  private policy?: PolicyConfig;

  async initialize(
    _config: Record<string, unknown>,
    env: Record<string, string>,
    options?: { policy?: PolicyConfig },
  ): Promise<void> {
    const apiKey = env.NEYNAR_API_KEY;
    const signerUuid = env.FARCASTER_SIGNER_UUID;
    const fid = env.FARCASTER_FID;

    if (!apiKey) throw new Error("Farcaster module requires NEYNAR_API_KEY");
    if (!signerUuid)
      throw new Error("Farcaster module requires FARCASTER_SIGNER_UUID");

    this.client = new NeynarClient(apiKey, signerUuid);
    this.fid = fid ? parseInt(fid, 10) : 0;
    this.policy = options?.policy;
  }

  getTools(): ToolDefinition[] {
    return farcasterTools;
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<string> {
    // Enforce channel allowlist for channel-scoped operations
    if (input.channel_id) {
      assertFarcasterChannelAllowed(this.policy, input.channel_id as string);
    }

    switch (name) {
      case "post_cast": {
        const result = await withRetry(() =>
          this.client.postCast(input.text as string, {
            channelId: input.channel_id as string | undefined,
            embeds: input.embeds as string[] | undefined,
          })
        );
        return JSON.stringify(result);
      }

      case "read_channel": {
        const casts = await withRetry(() =>
          this.client.getCasts(
            input.channel_id as string,
            (input.limit as number) ?? 10
          )
        );
        const summary = casts.map((c) => ({
          hash: c.hash,
          author: c.author.display_name || c.author.username,
          text: c.text,
          likes: c.reactions.likes_count,
          recasts: c.reactions.recasts_count,
          replies: c.replies.count,
          timestamp: c.timestamp,
        }));
        return JSON.stringify(summary);
      }

      case "read_mentions": {
        if (!this.fid) return "Error: FARCASTER_FID not set, cannot read mentions.";
        const mentions = await withRetry(() =>
          this.client.getMentions(
            this.fid,
            (input.limit as number) ?? 10
          )
        );
        return JSON.stringify(mentions);
      }

      case "reply_to_cast": {
        const result = await withRetry(() =>
          this.client.replyCast(
            input.parent_hash as string,
            input.text as string
          )
        );
        return JSON.stringify(result);
      }

      case "delete_cast": {
        const result = await withRetry(() =>
          this.client.deleteCast(
            input.target_hash as string
          )
        );
        return JSON.stringify(result);
      }

      case "fetch_cast": {
        const cast = await withRetry(() =>
          this.client.fetchCast(input.identifier as string)
        );
        // Return a clean summary + key fields
        const c = cast as Record<string, any>;
        const summary = {
          hash: c.hash,
          author: c.author?.username ?? "unknown",
          author_fid: c.author?.fid,
          text: c.text,
          timestamp: c.timestamp,
          channel: c.channel?.name ?? null,
          likes: c.reactions?.likes_count ?? 0,
          recasts: c.reactions?.recasts_count ?? 0,
          replies: c.replies?.count ?? 0,
          embeds: c.embeds ?? [],
        };
        return JSON.stringify(summary, null, 2);
      }

      case "search_casts": {
        const casts = await withRetry(() =>
          this.client.searchCasts(
            input.query as string,
            (input.limit as number) ?? 20,
          )
        );
        const results = casts.map((c: any) => ({
          hash: c.hash,
          author: c.author?.username ?? "unknown",
          author_fid: c.author?.fid,
          text: c.text?.slice(0, 300),
          timestamp: c.timestamp,
          likes: c.reactions?.likes_count ?? 0,
          recasts: c.reactions?.recasts_count ?? 0,
          replies: c.replies?.count ?? 0,
        }));
        return JSON.stringify(results, null, 2);
      }

      case "check_cast_engagement": {
        const cast = await withRetry(() =>
          this.client.fetchCast(input.hash as string)
        );
        const c = cast as Record<string, any>;
        const likes = c.reactions?.likes_count ?? 0;
        const recasts = c.reactions?.recasts_count ?? 0;
        const replies = c.replies?.count ?? 0;
        const score = likes * 3 + recasts * 5 + replies * 2;
        return JSON.stringify({
          hash: c.hash,
          text: c.text?.slice(0, 200),
          likes,
          recasts,
          replies,
          score,
          timestamp: c.timestamp,
        }, null, 2);
      }

      case "check_user": {
        const user = await withRetry(() =>
          this.client.lookupUser(input.fid as number)
        );
        const u = user as Record<string, any>;
        return JSON.stringify({
          fid: u.fid,
          username: u.username,
          display_name: u.display_name,
          score: u.score,
          is_spam: (u.score ?? 0) < 0.5,
          follower_count: u.follower_count,
          following_count: u.following_count,
        }, null, 2);
      }

      default:
        throw new Error(`Unknown farcaster tool: ${name}`);
    }
  }
}
