import { FarcasterModule } from "./src/modules/farcaster/index.js";
import { DatabaseModule } from "./src/modules/database/index.js";
import { GitHubModule } from "./src/modules/github/index.js";
import { OnchainModule } from "./src/modules/onchain/index.js";
import { XmtpModule } from "./src/modules/xmtp/index.js";

const modules = [
  new FarcasterModule(),
  new DatabaseModule(),
  new GitHubModule(),
  new OnchainModule(),
  new XmtpModule(),
];

console.log("Module tool counts:\n");
for (const mod of modules) {
  const tools = mod.getTools();
  console.log(`  ${mod.name}: ${tools.length} tools`);
  for (const t of tools) {
    console.log(`    - ${t.name}: ${t.description.slice(0, 60)}`);
  }
}
