import "dotenv/config";
import { FarcasterModule } from "./src/modules/farcaster/index.js";

const apiKey = process.env.NEYNAR_API_KEY;
const signerUuid = process.env.FARCASTER_SIGNER_UUID;

if (!apiKey) {
  console.error("Set NEYNAR_API_KEY environment variable");
  process.exit(1);
}

async function main() {
  const mod = new FarcasterModule();
  await mod.initialize({}, {
    NEYNAR_API_KEY: apiKey!,
    FARCASTER_SIGNER_UUID: signerUuid ?? "",
    FARCASTER_FID: process.env.FARCASTER_FID ?? "",
  });

  console.log(`Farcaster module loaded: ${mod.getTools().length} tools\n`);

  // Read channel
  console.log("Reading /tortoise channel...\n");
  const result = await mod.executeTool("read_channel", {
    channel_id: "tortoise",
    limit: 3,
  });

  const casts = JSON.parse(result) as Array<{
    author: string;
    text: string;
    likes: number;
    replies: number;
  }>;

  for (const cast of casts) {
    console.log(`@${cast.author}: ${cast.text.slice(0, 100)}`);
    console.log(`  ${cast.likes} likes, ${cast.replies} replies\n`);
  }

  console.log("Done.");
}

main().catch(console.error);
