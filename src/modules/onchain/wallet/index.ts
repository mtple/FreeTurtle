import type { WalletProvider } from "./types.js";

export type { WalletProvider } from "./types.js";

export async function createWalletProvider(
  env: Record<string, string>,
): Promise<WalletProvider | null> {
  // Priority 1: CDP Server Wallet
  if (env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) {
    const { createCdpProvider } = await import("./cdp.js");
    return createCdpProvider(env);
  }

  // Priority 2: Raw private key (fallback)
  if (env.CEO_PRIVATE_KEY) {
    const { createPrivateKeyProvider } = await import("./private-key.js");
    return createPrivateKeyProvider(env.CEO_PRIVATE_KEY);
  }

  // No wallet configured — read-only mode
  return null;
}
