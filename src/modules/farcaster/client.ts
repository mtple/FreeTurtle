const BASE_URL = "https://api.neynar.com/v2/farcaster";

export interface CastResponse {
  success: boolean;
  cast: {
    hash: string;
    author: { fid: number };
    text: string;
  };
}

export interface Cast {
  hash: string;
  text: string;
  timestamp: string;
  author: {
    fid: number;
    username: string;
    display_name: string;
  };
  reactions: {
    likes_count: number;
    recasts_count: number;
  };
  replies: {
    count: number;
  };
}

export class NeynarClient {
  private apiKey: string;
  private signerUuid: string;

  constructor(apiKey: string, signerUuid: string) {
    this.apiKey = apiKey;
    this.signerUuid = signerUuid;
  }

  async postCast(
    text: string,
    options?: { channelId?: string; parent?: string; embeds?: string[] }
  ): Promise<CastResponse> {
    const body: Record<string, unknown> = {
      signer_uuid: this.signerUuid,
      text,
    };

    if (options?.channelId) body.channel_id = options.channelId;
    if (options?.parent) body.parent = options.parent;
    if (options?.embeds) {
      body.embeds = options.embeds.map((url) => ({ url }));
    }

    const res = await fetch(`${BASE_URL}/cast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Neynar postCast failed (${res.status}): ${err}`);
    }

    return (await res.json()) as CastResponse;
  }

  async getCasts(channelId: string, limit = 10): Promise<Cast[]> {
    const params = new URLSearchParams({
      channel_ids: channelId,
      limit: String(limit),
    });

    const res = await fetch(`${BASE_URL}/feed/channels?${params}`, {
      headers: { "x-api-key": this.apiKey },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Neynar getCasts failed (${res.status}): ${err}`);
    }

    const data = (await res.json()) as { casts: Cast[] };
    return data.casts;
  }

  async getMentions(fid: number, limit = 10): Promise<Cast[]> {
    const params = new URLSearchParams({
      fid: String(fid),
      limit: String(limit),
    });

    const res = await fetch(`${BASE_URL}/notifications?${params}`, {
      headers: { "x-api-key": this.apiKey },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Neynar getMentions failed (${res.status}): ${err}`);
    }

    const data = (await res.json()) as { notifications: Cast[] };
    return data.notifications;
  }

  async replyCast(parentHash: string, text: string): Promise<CastResponse> {
    return this.postCast(text, { parent: parentHash });
  }

  async deleteCast(targetHash: string): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/cast`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({
        signer_uuid: this.signerUuid,
        target_hash: targetHash,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Neynar deleteCast failed (${res.status}): ${err}`);
    }

    return { success: true };
  }
}
