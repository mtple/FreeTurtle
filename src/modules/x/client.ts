import { TwitterApi } from "twitter-api-v2";

export interface PostResult {
  id: string;
  text: string;
}

export interface XPost {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    impression_count: number;
  };
}

export class XClient {
  private client: TwitterApi;

  constructor(
    appKey: string,
    appSecret: string,
    accessToken: string,
    accessSecret: string,
  ) {
    this.client = new TwitterApi({
      appKey,
      appSecret,
      accessToken,
      accessSecret,
    });
  }

  async post(text: string, options?: { replyToId?: string }): Promise<PostResult> {
    const payload: Record<string, unknown> = { text };
    if (options?.replyToId) {
      payload.reply = { in_reply_to_tweet_id: options.replyToId };
    }
    const result = await this.client.v2.tweet(payload as any);
    return {
      id: result.data.id,
      text: result.data.text,
    };
  }

  async reply(tweetId: string, text: string): Promise<PostResult> {
    const result = await this.client.v2.reply(text, tweetId);
    return {
      id: result.data.id,
      text: result.data.text,
    };
  }

  async deleteTweet(tweetId: string): Promise<{ deleted: boolean }> {
    const result = await this.client.v2.deleteTweet(tweetId);
    return { deleted: result.data.deleted };
  }

  async getTweet(tweetId: string): Promise<XPost> {
    const result = await this.client.v2.singleTweet(tweetId, {
      "tweet.fields": ["created_at", "public_metrics", "author_id"],
    });
    return {
      id: result.data.id,
      text: result.data.text,
      author_id: result.data.author_id,
      created_at: result.data.created_at,
      public_metrics: result.data.public_metrics,
    };
  }

  async getUserTimeline(userId: string, limit = 10): Promise<XPost[]> {
    const timeline = await this.client.v2.userTimeline(userId, {
      max_results: Math.min(limit, 100),
      "tweet.fields": ["created_at", "public_metrics", "author_id"],
    });
    return timeline.data.data?.map((t) => ({
      id: t.id,
      text: t.text,
      author_id: t.author_id,
      created_at: t.created_at,
      public_metrics: t.public_metrics,
    })) ?? [];
  }

  async searchRecent(query: string, limit = 10): Promise<XPost[]> {
    const result = await this.client.v2.search(query, {
      max_results: Math.min(Math.max(limit, 10), 100),
      "tweet.fields": ["created_at", "public_metrics", "author_id"],
    });
    return result.data.data?.map((t) => ({
      id: t.id,
      text: t.text,
      author_id: t.author_id,
      created_at: t.created_at,
      public_metrics: t.public_metrics,
    })) ?? [];
  }

  async getMe(): Promise<{ id: string; username: string; name: string }> {
    const result = await this.client.v2.me();
    return {
      id: result.data.id,
      username: result.data.username,
      name: result.data.name,
    };
  }
}
