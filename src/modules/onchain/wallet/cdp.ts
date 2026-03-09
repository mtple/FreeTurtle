import { toAccount } from "viem/accounts";
import type { WalletProvider } from "./types.js";

export async function createCdpProvider(
  env: Record<string, string>,
): Promise<WalletProvider> {
  const { CdpClient } = await import("@coinbase/cdp-sdk");

  const cdp = new CdpClient({
    apiKeyId: env.CDP_API_KEY_ID,
    apiKeySecret: env.CDP_API_KEY_SECRET,
    walletSecret: env.CDP_WALLET_SECRET,
  });

  const accountName = env.WALLET_ACCOUNT_NAME || "freeturtle-ceo";
  const cdpAccount = await cdp.evm.getOrCreateAccount({ name: accountName });

  const account = toAccount({
    address: cdpAccount.address as `0x${string}`,
    signMessage: async ({ message }) => cdpAccount.signMessage({ message }),
    signTransaction: async (transaction) =>
      cdpAccount.signTransaction(transaction),
    signTypedData: async (typedData) =>
      cdpAccount.signTypedData(typedData as Parameters<typeof cdpAccount.signTypedData>[0]),
  });

  return {
    type: "cdp",
    account,
    address: account.address,
  };
}
