import type { FreeTurtleModule, ToolDefinition } from "../types.js";
import type { PolicyConfig } from "../../policy.js";
import { assertOnchainScopeAllowed } from "../../policy.js";
import { withRetry } from "../../reliability.js";
import { OnchainClient } from "./client.js";
import { onchainTools } from "./tools.js";
import {
  taskboardTools,
  executeTaskboardTool,
} from "./taskboard.js";
import {
  portfolioTools,
  executePortfolioTool,
} from "./portfolio.js";

export class OnchainModule implements FreeTurtleModule {
  name = "onchain";
  description = "Read smart contracts, balances, and transactions on Base.";

  private client!: OnchainClient;
  private policy?: PolicyConfig;
  private env!: Record<string, string>;
  private hasWriteAccess = false;
  private hasTaskboard = false;
  private workspaceDir?: string;

  async initialize(
    _config: Record<string, unknown>,
    env: Record<string, string>,
    options?: { policy?: PolicyConfig },
  ): Promise<void> {
    const rpcUrl = env.RPC_URL;
    if (!rpcUrl) throw new Error("Onchain module requires RPC_URL");
    this.client = new OnchainClient(rpcUrl, env.BLOCK_EXPLORER_API_KEY);
    this.policy = options?.policy;
    this.env = env;
    this.workspaceDir = _config._workspaceDir as string | undefined;
    this.hasWriteAccess = !!env.CEO_PRIVATE_KEY && !!env.TASK_CHAIN_ID;
    this.hasTaskboard =
      this.hasWriteAccess && !!env.TASK_CONTRACT_ADDRESS;
  }

  getTools(): ToolDefinition[] {
    const tools = [...onchainTools];
    if (this.hasTaskboard) {
      tools.push(...taskboardTools);
    }
    if (this.hasWriteAccess) {
      tools.push(...portfolioTools);
    }
    return tools;
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    // Existing read-only tools
    switch (name) {
      case "read_contract": {
        assertOnchainScopeAllowed(
          this.policy,
          input.address as string,
          input.function_name as string,
        );
        const result = await withRetry(() =>
          this.client.readContract(
            input.address as string,
            input.abi as unknown[],
            input.function_name as string,
            input.args as unknown[] | undefined,
          ),
        );
        return JSON.stringify(result);
      }
      case "get_balance": {
        const balance = await withRetry(() =>
          this.client.getBalance(input.address as string),
        );
        return `${balance} ETH`;
      }
      case "get_transactions": {
        const txs = await withRetry(() =>
          this.client.getTransactions(
            input.address as string,
            (input.limit as number) ?? 10,
          ),
        );
        return JSON.stringify(txs);
      }
    }

    // TaskBoard tools
    if (
      this.hasTaskboard &&
      taskboardTools.some((t) => t.name === name)
    ) {
      return executeTaskboardTool(name, input, this.env, this.workspaceDir);
    }

    // Portfolio tools
    if (
      this.hasWriteAccess &&
      portfolioTools.some((t) => t.name === name)
    ) {
      return executePortfolioTool(name, input, this.env);
    }

    throw new Error(`Unknown onchain tool: ${name}`);
  }
}
