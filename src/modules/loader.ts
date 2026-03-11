import type { FreeTurtleConfig } from "../config.js";
import type { PolicyConfig } from "../policy.js";
import type { FreeTurtleModule } from "./types.js";
import type { Logger } from "../logger.js";
import { FarcasterModule } from "./farcaster/index.js";
import { DatabaseModule } from "./database/index.js";
import { GitHubModule } from "./github/index.js";
import { OnchainModule } from "./onchain/index.js";
import { XmtpModule } from "./xmtp/index.js";
import { GmailModule } from "./gmail/index.js";
import { WorkspaceModule } from "./workspace/index.js";
import { ShellModule } from "./shell/index.js";

const MODULE_MAP: Record<string, new () => FreeTurtleModule> = {
  farcaster: FarcasterModule,
  database: DatabaseModule,
  github: GitHubModule,
  gmail: GmailModule,
  onchain: OnchainModule,
  xmtp: XmtpModule,
  shell: ShellModule,
};

export async function loadModules(
  config: FreeTurtleConfig,
  env: Record<string, string>,
  logger?: Logger,
  policy?: PolicyConfig,
  dir?: string,
): Promise<FreeTurtleModule[]> {
  const modules: FreeTurtleModule[] = [];

  // Workspace module is always loaded — gives the CEO file access to its own workspace
  if (dir) {
    try {
      const workspace = new WorkspaceModule();
      await workspace.initialize({ _workspaceDir: dir }, env, { policy });
      modules.push(workspace);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger?.error(`Workspace module failed to initialize: ${msg}`);
    }
  }

  for (const [name, moduleConfig] of Object.entries(config.modules)) {
    if (!moduleConfig.enabled) continue;

    const ModuleClass = MODULE_MAP[name];
    if (!ModuleClass) {
      logger?.warn(`Unknown module: ${name} — skipping`);
      continue;
    }

    try {
      const mod = new ModuleClass();
      const cfg = { ...(moduleConfig as unknown as Record<string, unknown>) };
      if (dir) cfg._workspaceDir = dir;
      await mod.initialize(cfg, env, { policy });
      modules.push(mod);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger?.error(`Module "${name}" failed to initialize: ${msg} — skipping`);
    }
  }

  return modules;
}
