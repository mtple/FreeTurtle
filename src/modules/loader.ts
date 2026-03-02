import type { FreeTurtleConfig } from "../config.js";
import type { FreeTurtleModule } from "./types.js";
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
  env: Record<string, string>
): Promise<FreeTurtleModule[]> {
  const modules: FreeTurtleModule[] = [];

  for (const [name, moduleConfig] of Object.entries(config.modules)) {
    if (!moduleConfig.enabled) continue;

    const ModuleClass = MODULE_MAP[name];
    if (!ModuleClass) {
      console.warn(`Unknown module: ${name} — skipping`);
      continue;
    }

    const mod = new ModuleClass();
    await mod.initialize(
      moduleConfig as unknown as Record<string, unknown>,
      env
    );
    modules.push(mod);
  }

  return modules;
}
