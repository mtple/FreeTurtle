import type { FreeTurtleModule, ToolDefinition } from "../types.js";
import { OnchainClient } from "./client.js";
import { onchainTools } from "./tools.js";

export class OnchainModule implements FreeTurtleModule {
  name = "onchain";
  description = "Read smart contracts, balances, and transactions on Base.";

  private client!: OnchainClient;

  async initialize(
    _config: Record<string, unknown>,
    env: Record<string, string>
  ): Promise<void> {
    const rpcUrl = env.RPC_URL;
    if (!rpcUrl) throw new Error("Onchain module requires RPC_URL");
    this.client = new OnchainClient(rpcUrl, env.BASESCAN_API_KEY);
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
        const result = await this.client.readContract(
          input.address as string,
          input.abi as unknown[],
          input.function_name as string,
          input.args as unknown[] | undefined
        );
        return JSON.stringify(result);
      }
      case "get_balance": {
        const balance = await this.client.getBalance(input.address as string);
        return `${balance} ETH`;
      }
      case "get_transactions": {
        const txs = await this.client.getTransactions(
          input.address as string,
          (input.limit as number) ?? 10
        );
        return JSON.stringify(txs);
      }
      default:
        throw new Error(`Unknown onchain tool: ${name}`);
    }
  }
}
