import * as p from "@clack/prompts";
import { testBraveSearch } from "./connection-tests.js";
import { upsertEnv } from "./env-utils.js";
import { enableModule } from "./config-utils.js";

export async function connectWebSearch(dir: string): Promise<null | { apiKey: string }> {
  p.intro("Connect Web Search (Brave)");

  p.note(
    [
      "Get a free API key at:",
      "  brave.com/search/api",
      "",
      "The free plan includes 2,000 queries/month.",
      "Your CEO will use this for web research.",
    ].join("\n"),
    "Brave Search Setup"
  );

  const apiKey = await p.text({
    message: "Brave Search API key:",
    validate: (v) => (!v || v.length < 10 ? "Invalid API key" : undefined),
  });
  if (p.isCancel(apiKey)) { p.cancel("Cancelled."); return null; }

  const s = p.spinner();
  s.start("Testing connection...");
  try {
    await testBraveSearch(apiKey);
    s.stop("Connected!");
  } catch (err) {
    s.stop("Connection failed.");
    p.log.error(err instanceof Error ? err.message : String(err));
    return null;
  }

  await upsertEnv(dir, { BRAVE_API_KEY: apiKey });
  await enableModule(dir, "web-search");

  p.log.success("Credentials saved to .env");
  p.log.info("Module enabled in config.md");
  p.outro("Web search connected! Your CEO can now search the web.");

  return { apiKey };
}
