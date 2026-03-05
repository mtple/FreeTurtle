import type { FreeTurtleModule, ToolDefinition } from "../types.js";
import type { PolicyConfig } from "../../policy.js";
import { assertOnchainScopeAllowed } from "../../policy.js";
import { withRetry } from "../../reliability.js";
import { OnchainClient } from "./client.js";
import { onchainTools } from "./tools.js";

export class OnchainModule implements FreeTurtleModule {
  name = "onchain";
  description = "Read smart contracts, balances, and transactions on Base.";

  private client!: OnchainClient;
  private policy?: PolicyConfig;

  async initialize(
    _config: Record<string, unknown>,
    env: Record<string, string>,
    options?: { policy?: PolicyConfig },
  ): Promise<void> {
    const rpcUrl = env.RPC_URL;
    if (!rpcUrl) throw new Error("Onchain module requires RPC_URL");
    this.client = new OnchainClient(rpcUrl, env.BASESCAN_API_KEY);
    this.policy = options?.policy;
  }

  getTools(): ToolDefinition[] {
    return onchainTools;
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<string> {
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
            input.args as unknown[] | undefined
          )
        );
        return JSON.stringify(result);
      }
      case "get_balance": {
        const balance = await withRetry(() =>
          this.client.getBalance(input.address as string)
        );
        return `${balance} ETH`;
      }
      case "get_transactions": {
        const txs = await withRetry(() =>
          this.client.getTransactions(
            input.address as string,
            (input.limit as number) ?? 10
          )
        );
        return JSON.stringify(txs);
      }
      default:
        throw new Error(`Unknown onchain tool: ${name}`);
    }
  }
}
