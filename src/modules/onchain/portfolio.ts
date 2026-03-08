import { parseUnits, formatUnits, formatEther } from "viem";
import type { ToolDefinition } from "../types.js";
import { getClients, explorerTxUrl } from "./chains.js";

const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export const portfolioTools: ToolDefinition[] = [
  {
    name: "transfer_token",
    description:
      "Transfer ERC20 tokens from the CEO wallet to another address. Used to execute portfolio strategies by moving tokenized assets (stock tokens, stablecoins, etc.). Always check token balance before transferring.",
    input_schema: {
      type: "object",
      properties: {
        token_address: {
          type: "string",
          description: "Contract address of the ERC20 token",
        },
        to_address: {
          type: "string",
          description: "Recipient address",
        },
        amount: {
          type: "string",
          description:
            'Amount in human-readable units (e.g. "2.5" for 2.5 tokens)',
        },
      },
      required: ["token_address", "to_address", "amount"],
    },
  },
  {
    name: "get_token_balance",
    description:
      "Check the balance of an ERC20 token (stock tokens, stablecoins, etc.) for any address. Defaults to the CEO wallet if no address specified.",
    input_schema: {
      type: "object",
      properties: {
        token_address: {
          type: "string",
          description: "Contract address of the ERC20 token",
        },
        wallet_address: {
          type: "string",
          description: "Address to check. Defaults to CEO wallet.",
        },
      },
      required: ["token_address"],
    },
  },
  {
    name: "get_ceo_wallet_balance",
    description:
      "Check the CEO wallet's native ETH balance on the task chain.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

export async function executePortfolioTool(
  name: string,
  input: Record<string, unknown>,
  env: Record<string, string>,
): Promise<string> {
  try {
    switch (name) {
      case "transfer_token":
        return await transferToken(
          input.token_address as string,
          input.to_address as string,
          input.amount as string,
          env,
        );
      case "get_token_balance":
        return await getTokenBalance(
          input.token_address as string,
          input.wallet_address as string | undefined,
          env,
        );
      case "get_ceo_wallet_balance":
        return await getCeoWalletBalance(env);
      default:
        throw new Error(`Unknown portfolio tool: ${name}`);
    }
  } catch (error: unknown) {
    const msg =
      error instanceof Error
        ? (error as { shortMessage?: string }).shortMessage || error.message
        : "Unknown error";
    return JSON.stringify({ error: true, message: `Failed: ${msg}` });
  }
}

async function transferToken(
  tokenAddress: string,
  toAddress: string,
  amount: string,
  env: Record<string, string>,
): Promise<string> {
  const { chain, account, walletClient, publicClient } = getClients(env);

  const [decimals, symbol] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "symbol",
    }),
  ]);

  const parsedAmount = parseUnits(amount, decimals);

  const hash = await walletClient.writeContract({
    chain,
    account,
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [toAddress as `0x${string}`, parsedAmount],
  });

  await publicClient.waitForTransactionReceipt({ hash });

  return JSON.stringify({
    token: symbol,
    tokenAddress,
    amount,
    to: toAddress,
    txHash: hash,
    explorerUrl: explorerTxUrl(chain, hash),
    chain: chain.name,
  });
}

async function getTokenBalance(
  tokenAddress: string,
  walletAddress: string | undefined,
  env: Record<string, string>,
): Promise<string> {
  const { chain, publicClient, account } = getClients(env);
  const address = (walletAddress || account.address) as `0x${string}`;

  const [balance, decimals, symbol] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    }),
    publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "symbol",
    }),
  ]);

  return JSON.stringify({
    token: symbol,
    tokenAddress,
    balance: formatUnits(balance, decimals),
    wallet: address,
    chain: chain.name,
  });
}

async function getCeoWalletBalance(
  env: Record<string, string>,
): Promise<string> {
  const { chain, publicClient, account } = getClients(env);

  const balance = await publicClient.getBalance({
    address: account.address,
  });

  return JSON.stringify({
    address: account.address,
    balanceEth: formatEther(balance),
    chain: chain.name,
  });
}
