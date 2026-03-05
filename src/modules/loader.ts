import type { FreeTurtleConfig } from "../config.js";
import type { FreeTurtleModule } from "./types.js";
import type { Logger } from "../logger.js";
import { FarcasterModule } from "./farcaster/index.js";
import { DatabaseModule } from "./database/index.js";
import { GitHubModule } from "./github/index.js";
import { OnchainModule } from "./onchain/index.js";
import { XmtpModule } from "./xmtp/index.js";

const MODULE_MAP: Record<string, new () => FreeTurtleModule> = {
  farcaster: FarcasterModule,
  database: DatabaseModule,
  github: GitHubModule,
  onchain: OnchainModule,
  xmtp: XmtpModule,
};

export async function loadModules(
  config: FreeTurtleConfig,
  env: Record<string, string>,
  logger?: Logger
): Promise<FreeTurtleModule[]> {
  const modules: FreeTurtleModule[] = [];

  for (const [name, moduleConfig] of Object.entries(config.modules)) {
    if (!moduleConfig.enabled) continue;

    const ModuleClass = MODULE_MAP[name];
    if (!ModuleClass) {
      logger?.warn(`Unknown module: ${name} — skipping`);
      continue;
    }

    try {
      const mod = new ModuleClass();
      await mod.initialize(
        moduleConfig as unknown as Record<string, unknown>,
        env
      );
      modules.push(mod);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger?.error(`Module "${name}" failed to initialize: ${msg} — skipping`);
    }
  }

  return modules;
}
