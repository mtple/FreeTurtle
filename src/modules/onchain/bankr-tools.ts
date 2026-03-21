import type { ToolDefinition } from "../types.js";
import type { BankrWalletClient } from "./wallet/bankr.js";

export const bankrTools: ToolDefinition[] = [
  {
    name: "bankr_balances",
    description:
      "Get token balances across all supported chains (Base, Ethereum, Polygon, Unichain, Solana). Returns native and token balances with USD values.",
    input_schema: {
      type: "object",
      properties: {
        chains: {
          type: "string",
          description:
            'Comma-separated chain filter (e.g. "base,solana"). Omit for all chains.',
        },
      },
      required: [],
    },
  },
  {
    name: "bankr_prompt",
    description:
      'YOUR PRIMARY TOOL for all onchain transactions. Use this to swap tokens, transfer funds, check prices, deploy tokens, and any other onchain operation. This tool handles everything — routing, approvals, gas, and execution across Base, Ethereum, Polygon, Unichain, and Solana. Just describe what you want in plain English. Examples: "swap $1 of ETH for USDC on base", "transfer 0.5 ETH to 0x123... on base", "what is the price of BTC?", "deploy a token called MyAgent with symbol AGENT on base". Always specify the chain name and token symbols.',
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "Natural language onchain command. Always include the chain (e.g. 'on base'), token symbols, and amounts.",
        },
      },
      required: ["command"],
    },
  },
];

async function pollJob(
  client: BankrWalletClient,
  jobId: string,
): Promise<string> {
  let delay = 2000;
  const maxDelay = 5000;
  const deadline = Date.now() + 300000;

  while (Date.now() < deadline) {
    const job = await client.getJobStatus(jobId);

    if (job.status === "completed") {
      return job.response ?? "Job completed (no response body).";
    }
    if (job.status === "failed") {
      return `Job failed: ${job.response ?? "unknown error"}`;
    }
    if (job.status === "cancelled") {
      return "Job was cancelled.";
    }

    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, maxDelay);
  }

  return `Job ${jobId} timed out after 5 minutes. It may still complete — the transaction could be pending on-chain.`;
}

export async function executeBankrTool(
  name: string,
  input: Record<string, unknown>,
  client: BankrWalletClient,
): Promise<string> {
  switch (name) {
    case "bankr_balances": {
      const chains = input.chains
        ? (input.chains as string).split(",").map((c) => c.trim())
        : undefined;
      const data = await client.getBalances(chains);

      const lines: string[] = [
        `EVM Address: ${data.evmAddress}`,
        `Solana Address: ${data.solAddress}`,
        "",
      ];

      for (const [chain, info] of Object.entries(data.balances)) {
        lines.push(
          `## ${chain}`,
          `Native: ${info.nativeBalance} ($${info.nativeUsd})`,
        );
        if (info.tokenBalances?.length) {
          for (const tb of info.tokenBalances) {
            const t = tb.token;
            lines.push(
              `  ${t.baseToken.symbol}: ${t.balance} ($${t.balanceUSD.toFixed(2)})`,
            );
          }
        }
        lines.push(`Total: $${info.total}`, "");
      }

      return lines.join("\n");
    }

    case "bankr_prompt": {
      const command = input.command as string;
      console.error(`[DEBUG] bankr_prompt command: ${command}`);
      const res = await client.prompt(command);
      console.error(`[DEBUG] bankr_prompt response: ${JSON.stringify(res)}`);

      if (!res.success) {
        return `Bankr prompt failed: ${res.message ?? "unknown error"}`;
      }

      const result = await pollJob(client, res.jobId);
      console.error(`[DEBUG] bankr_prompt result: ${result.slice(0, 500)}`);
      return result;
    }

    default:
      throw new Error(`Unknown bankr tool: ${name}`);
  }
}
