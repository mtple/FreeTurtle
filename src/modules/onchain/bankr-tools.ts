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
      'Execute an onchain command using natural language. Examples: "what is the price of ETH?", "swap 0.1 ETH for USDC on Base", "what are my token balances?", "deploy a token called MyAgent with symbol AGENT on base". The command is processed asynchronously and this tool waits for the result.',
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "Natural language onchain command. Be specific with amounts, chain names, and token symbols.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "bankr_job_status",
    description:
      "Check the status of a previously submitted bankr job. Use this if a prior bankr_prompt timed out and you want to check if it completed.",
    input_schema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "The job ID returned by a previous bankr_prompt call.",
        },
      },
      required: ["jobId"],
    },
  },
];

async function pollJob(
  client: BankrWalletClient,
  jobId: string,
): Promise<string> {
  let delay = 1000;
  const maxDelay = 16000;
  const deadline = Date.now() + 60000;

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

  return `Job ${jobId} is still processing. Use bankr_job_status to check later.`;
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
      const res = await client.prompt(command);

      if (!res.success) {
        return `Bankr prompt failed: ${res.message ?? "unknown error"}`;
      }

      return pollJob(client, res.jobId);
    }

    case "bankr_job_status": {
      const jobId = input.jobId as string;
      const job = await client.getJobStatus(jobId);
      return JSON.stringify(job, null, 2);
    }

    default:
      throw new Error(`Unknown bankr tool: ${name}`);
  }
}
