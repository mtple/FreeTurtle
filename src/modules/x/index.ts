import type { FreeTurtleModule, ToolDefinition } from "../types.js";
import { withRetry } from "../../reliability.js";
import { XClient } from "./client.js";
import { xTools } from "./tools.js";

export class XModule implements FreeTurtleModule {
  name = "x";
  description = "Post and read tweets on X (formerly Twitter) via the X API v2.";

  private client!: XClient;

  async initialize(
    _config: Record<string, unknown>,
    env: Record<string, string>,
  ): Promise<void> {
    const appKey = env.X_API_KEY;
    const appSecret = env.X_API_SECRET;
    const accessToken = env.X_ACCESS_TOKEN;
    const accessSecret = env.X_ACCESS_SECRET;

    if (!appKey) throw new Error("X module requires X_API_KEY");
    if (!appSecret) throw new Error("X module requires X_API_SECRET");
    if (!accessToken) throw new Error("X module requires X_ACCESS_TOKEN");
    if (!accessSecret) throw new Error("X module requires X_ACCESS_SECRET");

    this.client = new XClient(appKey, appSecret, accessToken, accessSecret);
  }

  getTools(): ToolDefinition[] {
    return xTools;
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    switch (name) {
      case "x_post": {
        const result = await withRetry(() =>
          this.client.post(input.text as string),
        );
        return JSON.stringify(result);
      }

      case "x_reply": {
        const result = await withRetry(() =>
          this.client.reply(
            input.tweet_id as string,
            input.text as string,
          ),
        );
        return JSON.stringify(result);
      }

      case "x_delete": {
        const result = await withRetry(() =>
          this.client.deleteTweet(input.tweet_id as string),
        );
        return JSON.stringify(result);
      }

      case "x_get_tweet": {
        const tweet = await withRetry(() =>
          this.client.getTweet(input.tweet_id as string),
        );
        return JSON.stringify(tweet, null, 2);
      }

      case "x_timeline": {
        const tweets = await withRetry(() =>
          this.client.getUserTimeline(
            input.user_id as string,
            (input.limit as number) ?? 10,
          ),
        );
        return JSON.stringify(tweets, null, 2);
      }

      case "x_search": {
        const tweets = await withRetry(() =>
          this.client.searchRecent(
            input.query as string,
            (input.limit as number) ?? 10,
          ),
        );
        return JSON.stringify(tweets, null, 2);
      }

      case "x_me": {
        const me = await withRetry(() => this.client.getMe());
        return JSON.stringify(me, null, 2);
      }

      default:
        throw new Error(`Unknown X tool: ${name}`);
    }
  }
}
