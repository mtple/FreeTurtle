import type { Account } from "viem";

export interface WalletProvider {
  readonly type: "cdp" | "private-key" | "bankr";
  readonly account: Account;
  readonly address: `0x${string}`;
}
