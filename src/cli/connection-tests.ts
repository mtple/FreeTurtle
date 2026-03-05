import pg from "pg";

/**
 * Test a Telegram bot token by calling getMe.
 */
export async function testTelegram(token: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) {
    throw new Error(`Telegram returned error: ${data.description ?? "unknown"}`);
  }
}

/**
 * Test a GitHub personal access token by calling /user.
 */
export async function testGitHub(token: string): Promise<void> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${body}`);
  }
}

/**
 * Test a Postgres connection URL by connecting and immediately disconnecting.
 */
export async function testDatabase(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Test an EVM RPC URL by calling eth_blockNumber.
 */
export async function testOnchain(rpcUrl: string): Promise<void> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
      id: 1,
    }),
  });
  if (!res.ok) {
    throw new Error(`RPC error (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { error?: { message: string } };
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }
}
