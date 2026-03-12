import * as p from "@clack/prompts";
import { testGitHub } from "./connection-tests.js";
import { upsertEnv } from "./env-utils.js";
import { enableModule } from "./config-utils.js";

export async function connectGitHub(dir: string): Promise<null | { token: string }> {
  p.intro("Connect GitHub");

  p.note(
    [
      "Create a personal access token at:",
      "  github.com/settings/tokens",
      "",
      "Required scopes: repo, read:user",
    ].join("\n"),
    "GitHub Setup"
  );

  const token = await p.text({
    message: "GitHub personal access token:",
    validate: (v) => (!v || v.length < 10 ? "Invalid token" : undefined),
  });
  if (p.isCancel(token)) { p.cancel("Cancelled."); return null; }

  const s = p.spinner();
  s.start("Testing connection...");
  try {
    await testGitHub(token);
    s.stop("Connected!");
  } catch (err) {
    s.stop("Connection failed.");
    p.log.error(err instanceof Error ? err.message : String(err));
    return null;
  }

  await upsertEnv(dir, { GITHUB_TOKEN: token });
  await enableModule(dir, "github");

  p.log.success("Credentials saved to .env");

  // Try to hot-reload the running daemon
  try {
    const { rpcCall } = await import("../rpc/client.js");
    await rpcCall("reload");
    p.log.success("Daemon reloaded — GitHub is now active.");
  } catch {
    p.log.info("Run 'freeturtle reload' or restart the daemon to activate GitHub.");
  }

  p.outro("GitHub connected!");

  return { token };
}
