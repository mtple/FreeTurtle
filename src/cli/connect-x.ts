import * as p from "@clack/prompts";
import { upsertEnv } from "./env-utils.js";
import { enableModule } from "./config-utils.js";

export async function connectX(dir: string): Promise<null | { appKey: string }> {
  p.intro("Connect X (formerly Twitter)");

  p.note(
    [
      "You need an X developer account and a project with OAuth 1.0a keys.",
      "",
      "1. Go to developer.x.com and create a project/app",
      "2. In your app settings, set User Authentication to Read and Write",
      "3. Generate these 4 credentials from the Keys and Tokens tab:",
      "   - API Key (Consumer Key)",
      "   - API Secret (Consumer Secret)",
      "   - Access Token",
      "   - Access Token Secret",
      "",
      "The free tier allows 1,500 posts/month.",
      "Pay-as-you-go is also available (no subscription needed).",
    ].join("\n"),
    "X API Setup"
  );

  const apiKey = await p.text({
    message: "API Key (Consumer Key):",
    validate: (v) => (!v?.trim() ? "Required" : undefined),
  });
  if (p.isCancel(apiKey)) { p.cancel("Cancelled."); return null; }

  const apiSecret = await p.text({
    message: "API Secret (Consumer Secret):",
    validate: (v) => (!v?.trim() ? "Required" : undefined),
  });
  if (p.isCancel(apiSecret)) { p.cancel("Cancelled."); return null; }

  const accessToken = await p.text({
    message: "Access Token:",
    validate: (v) => (!v?.trim() ? "Required" : undefined),
  });
  if (p.isCancel(accessToken)) { p.cancel("Cancelled."); return null; }

  const accessSecret = await p.text({
    message: "Access Token Secret:",
    validate: (v) => (!v?.trim() ? "Required" : undefined),
  });
  if (p.isCancel(accessSecret)) { p.cancel("Cancelled."); return null; }

  // Test the connection
  const s = p.spinner();
  s.start("Testing connection...");
  try {
    const { TwitterApi } = await import("twitter-api-v2");
    const client = new TwitterApi({
      appKey: apiKey.trim(),
      appSecret: apiSecret.trim(),
      accessToken: accessToken.trim(),
      accessSecret: accessSecret.trim(),
    });
    const me = await client.v2.me();
    s.stop(`Connected as @${me.data.username}`);
  } catch (err) {
    s.stop("Connection failed.");
    p.log.error(err instanceof Error ? err.message : String(err));
    return null;
  }

  await upsertEnv(dir, {
    X_API_KEY: apiKey.trim(),
    X_API_SECRET: apiSecret.trim(),
    X_ACCESS_TOKEN: accessToken.trim(),
    X_ACCESS_SECRET: accessSecret.trim(),
  });
  await enableModule(dir, "x");

  p.log.success("Credentials saved to .env");
  p.log.info("Module enabled in config.md");

  try {
    const { rpcCall } = await import("../rpc/client.js");
    await rpcCall("reload");
    p.log.success("Daemon reloaded — X posting is now active.");
  } catch {
    p.log.info("Run 'freeturtle reload' or restart the daemon to activate X.");
  }

  p.outro("X connected! Your CEO can now post tweets.");

  return { appKey: apiKey.trim() };
}
