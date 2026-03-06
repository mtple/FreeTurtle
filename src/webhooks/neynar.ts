const NEYNAR_BASE = "https://api.neynar.com/v2/farcaster";

export interface NeynarWebhook {
  webhook_id: string;
  title: string;
  url: string;
  active: boolean;
  subscription: {
    "cast.created"?: {
      mentioned_fids?: number[];
      parent_author_fids?: number[];
      author_fids?: number[];
      root_parent_urls?: string[];
    };
  };
}

export interface WebhookSubscription {
  /** FIDs to listen for mentions of (someone @'s these accounts) */
  mentionedFids?: number[];
  /** FIDs to listen for replies to (someone replies to these accounts' casts) */
  parentAuthorFids?: number[];
  /** FIDs to listen for any casts from (watch specific users) */
  authorFids?: number[];
  /** Farcaster channel URLs to listen for new casts in */
  channelUrls?: string[];
}

export async function createWebhook(
  apiKey: string,
  title: string,
  targetUrl: string,
  subscription: WebhookSubscription,
): Promise<NeynarWebhook> {
  const castCreated: Record<string, unknown> = {};
  if (subscription.mentionedFids?.length) {
    castCreated.mentioned_fids = subscription.mentionedFids;
  }
  if (subscription.parentAuthorFids?.length) {
    castCreated.parent_author_fids = subscription.parentAuthorFids;
  }
  if (subscription.authorFids?.length) {
    castCreated.author_fids = subscription.authorFids;
  }
  if (subscription.channelUrls?.length) {
    castCreated.root_parent_urls = subscription.channelUrls;
  }

  const res = await fetch(`${NEYNAR_BASE}/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      name: title,
      url: targetUrl,
      subscription: {
        "cast.created": castCreated,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Neynar createWebhook failed (${res.status}): ${text}`);
  }

  return (await res.json()) as NeynarWebhook;
}

export async function deleteWebhook(
  apiKey: string,
  webhookId: string,
): Promise<void> {
  const res = await fetch(`${NEYNAR_BASE}/webhook`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ webhook_id: webhookId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Neynar deleteWebhook failed (${res.status}): ${text}`);
  }
}

export async function listWebhooks(
  apiKey: string,
): Promise<NeynarWebhook[]> {
  const res = await fetch(`${NEYNAR_BASE}/webhook`, {
    headers: { "x-api-key": apiKey },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Neynar listWebhooks failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { webhooks: NeynarWebhook[] };
  return data.webhooks;
}

/** Convert a Farcaster channel name to its parent URL format */
export function channelToUrl(channelId: string): string {
  return `https://warpcast.com/~/channel/${channelId}`;
}
