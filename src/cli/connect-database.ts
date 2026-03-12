import * as p from "@clack/prompts";
import { testDatabase } from "./connection-tests.js";
import { upsertEnv } from "./env-utils.js";
import { enableModule } from "./config-utils.js";

export async function connectDatabase(dir: string): Promise<null | { url: string }> {
  p.intro("Connect Database");

  const url = await p.text({
    message: "Postgres connection URL:",
    placeholder: "postgresql://user:pass@host:5432/dbname",
    validate: (v) => (v?.startsWith("postgres") ? undefined : "Must be a postgres:// or postgresql:// URL"),
  });
  if (p.isCancel(url)) { p.cancel("Cancelled."); return null; }

  const s = p.spinner();
  s.start("Testing connection...");
  try {
    await testDatabase(url);
    s.stop("Connected!");
  } catch (err) {
    s.stop("Connection failed.");
    p.log.error(err instanceof Error ? err.message : String(err));
    return null;
  }

  await upsertEnv(dir, { DATABASE_URL: url });

  p.log.success("Credentials saved to .env");

  await enableModule(dir, "database");

  try {
    const { rpcCall } = await import("../rpc/client.js");
    await rpcCall("reload");
    p.log.success("Daemon reloaded — Database is now active.");
  } catch {
    p.log.info("Run 'freeturtle reload' or restart the daemon to activate Database.");
  }

  p.outro("Database connected!");

  return { url };
}
