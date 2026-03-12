import * as p from "@clack/prompts";
import { testTelegram } from "./connection-tests.js";
import { upsertEnv } from "./env-utils.js";

export async function connectTelegram(dir: string): Promise<null | { token: string; ownerId: string }> {
  p.intro("Connect Telegram");

  const token = await p.text({
    message: "Telegram bot token (from @BotFather):",
    validate: (v) => (!v || v.length < 10 ? "Invalid token" : undefined),
  });
  if (p.isCancel(token)) { p.cancel("Cancelled."); return null; }

  const s = p.spinner();
  s.start("Testing connection...");
  try {
    await testTelegram(token);
    s.stop("Connected!");
  } catch (err) {
    s.stop("Connection failed.");
    p.log.error(err instanceof Error ? err.message : String(err));
    return null;
  }

  const ownerId = await p.text({
    message: "Your Telegram user ID (founder only — the CEO will only respond to this ID):",
    validate: (v) => (v && /^\d+$/.test(v) ? undefined : "Must be a numeric ID"),
  });
  if (p.isCancel(ownerId)) { p.cancel("Cancelled."); return null; }

  await upsertEnv(dir, {
    TELEGRAM_BOT_TOKEN: token,
    TELEGRAM_OWNER_ID: ownerId,
  });

  p.log.success("Credentials saved to .env");

  try {
    const { rpcCall } = await import("../rpc/client.js");
    await rpcCall("reload");
    p.log.success("Daemon reloaded — Telegram is now active.");
  } catch {
    p.log.info("Run 'freeturtle reload' or restart the daemon to activate Telegram.");
  }

  p.outro("Telegram connected!");

  return { token, ownerId };
}
