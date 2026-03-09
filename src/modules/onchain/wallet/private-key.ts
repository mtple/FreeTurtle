import { privateKeyToAccount } from "viem/accounts";
import type { WalletProvider } from "./types.js";

export function createPrivateKeyProvider(key: string): WalletProvider {
  const account = privateKeyToAccount(key as `0x${string}`);
  return {
    type: "private-key",
    account,
    address: account.address,
  };
}
