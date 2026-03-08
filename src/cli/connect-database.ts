import * as p from "@clack/prompts";
import { testDatabase } from "./connection-tests.js";
import { upsertEnv } from "./env-utils.js";

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
  p.outro("Database connected!");

  return { url };
}
