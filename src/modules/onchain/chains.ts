import {
  defineChain,
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const KNOWN_CHAINS: Record<number, Chain> = {
  46630: defineChain({
    id: 46630,
    name: "Robinhood Chain Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
    },
    blockExplorers: {
      default: {
        name: "Explorer",
        url: "https://explorer.testnet.chain.robinhood.com",
      },
    },
  }),
  421614: defineChain({
    id: 421614,
    name: "Arbitrum Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] },
    },
    blockExplorers: {
      default: { name: "Arbiscan", url: "https://sepolia.arbiscan.io" },
    },
  }),
  8453: defineChain({
    id: 8453,
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://mainnet.base.org"] } },
    blockExplorers: {
      default: { name: "Basescan", url: "https://basescan.org" },
    },
  }),
};

export interface TaskChainClients {
  chain: Chain;
  account: PrivateKeyAccount;
  walletClient: WalletClient;
  publicClient: PublicClient;
}

export function getTaskChain(env: Record<string, string>): Chain {
  const chainId = parseInt(env.TASK_CHAIN_ID || "0");
  const rpcOverride = env.TASK_CHAIN_RPC;

  let chain = KNOWN_CHAINS[chainId];
  if (!chain && rpcOverride) {
    chain = defineChain({
      id: chainId,
      name: `Chain ${chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcOverride] } },
    });
  }
  if (!chain)
    throw new Error(`Unknown chain ID ${chainId} and no TASK_CHAIN_RPC set`);

  if (rpcOverride) {
    chain = { ...chain, rpcUrls: { default: { http: [rpcOverride] } } };
  }
  return chain;
}

export function getCeoAccount(
  env: Record<string, string>,
): PrivateKeyAccount {
  const key = env.CEO_PRIVATE_KEY;
  if (!key) throw new Error("CEO_PRIVATE_KEY not set");
  return privateKeyToAccount(key as `0x${string}`);
}

export function getClients(env: Record<string, string>): TaskChainClients {
  const chain = getTaskChain(env);
  const account = getCeoAccount(env);
  return {
    chain,
    account,
    walletClient: createWalletClient({
      account,
      chain,
      transport: http(),
    }),
    publicClient: createPublicClient({ chain, transport: http() }),
  };
}

export function explorerTxUrl(chain: Chain, hash: string): string {
  return chain.blockExplorers?.default?.url
    ? `${chain.blockExplorers.default.url}/tx/${hash}`
    : hash;
}
