import * as p from "@clack/prompts";
import { testOnchain } from "./connection-tests.js";
import { upsertEnv } from "./env-utils.js";
import { enableModule } from "./config-utils.js";

export async function connectOnchain(dir: string): Promise<null | { rpcUrl: string }> {
  p.intro("Connect Onchain");

  const rpcUrl = await p.text({
    message: "EVM RPC URL:",
    placeholder: "https://mainnet.base.org",
    validate: (v) => (v?.startsWith("http") ? undefined : "Must be an HTTP(S) URL"),
  });
  if (p.isCancel(rpcUrl)) { p.cancel("Cancelled."); return null; }

  const s = p.spinner();
  s.start("Testing connection...");
  try {
    await testOnchain(rpcUrl);
    s.stop("Connected!");
  } catch (err) {
    s.stop("Connection failed.");
    p.log.error(err instanceof Error ? err.message : String(err));
    return null;
  }

  await upsertEnv(dir, { RPC_URL: rpcUrl });

  p.log.success("Credentials saved to .env");

  await enableModule(dir, "onchain");

  try {
    const { rpcCall } = await import("../rpc/client.js");
    await rpcCall("reload");
    p.log.success("Daemon reloaded — Onchain is now active.");
  } catch {
    p.log.info("Run 'freeturtle reload' or restart the daemon to activate Onchain.");
  }

  p.outro("Onchain connected!");

  return { rpcUrl };
}
