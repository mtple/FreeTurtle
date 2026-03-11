import type { FreeTurtleModule, ToolDefinition } from "../types.js";
import type { PolicyConfig } from "../../policy.js";
import { assertOnchainScopeAllowed } from "../../policy.js";
import { withRetry } from "../../reliability.js";
import { isAlpha, ALPHA_REQUIRED_MSG } from "../../alpha.js";
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
import { createWalletProvider, type WalletProvider } from "./wallet/index.js";
import { setCachedAccount, getTaskChain } from "./chains.js";
import { createPublicClient, formatEther, http } from "viem";

export class OnchainModule implements FreeTurtleModule {
  name = "onchain";
  description = "Read smart contracts, balances, and transactions on Base.";

  private client!: OnchainClient;
  private policy?: PolicyConfig;
  private env!: Record<string, string>;
  private hasWriteAccess = false;
  private hasTaskboard = false;
  private workspaceDir?: string;
  private walletProvider: WalletProvider | null = null;

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

    // Server wallet, taskboard, and portfolio are alpha features
    if (isAlpha()) {
      this.walletProvider = await createWalletProvider(env);
      if (this.walletProvider) {
        setCachedAccount(this.walletProvider.account);
      }

      this.hasWriteAccess = this.walletProvider !== null && !!env.TASK_CHAIN_ID;
      this.hasTaskboard =
        this.hasWriteAccess && !!env.TASK_CONTRACT_ADDRESS;
    }
  }

  getTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [...onchainTools];

    if (isAlpha()) {
      tools.push({
        name: "wallet_status",
        description:
          "Check the current wallet provider status, address, chain, and ETH balance.",
        input_schema: {
          type: "object",
          properties: {},
          required: [],
        },
      });
      if (this.hasTaskboard) {
        tools.push(...taskboardTools);
      }
      if (this.hasWriteAccess) {
        tools.push(...portfolioTools);
      }
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
      case "wallet_status": {
        if (!isAlpha()) return ALPHA_REQUIRED_MSG;
        if (!this.walletProvider) {
          return "No wallet configured. Set CDP_API_KEY_ID + CDP_API_KEY_SECRET for CDP wallet, or CEO_PRIVATE_KEY for private key wallet.";
        }
        const status: Record<string, string> = {
          provider: this.walletProvider.type,
          address: this.walletProvider.address,
        };
        if (this.env.TASK_CHAIN_ID) {
          try {
            const chain = getTaskChain(this.env);
            status.chain = chain.name;
            const pub = createPublicClient({ chain, transport: http() });
            const bal = await pub.getBalance({
              address: this.walletProvider.address,
            });
            status.balance = `${formatEther(bal)} ETH`;
          } catch {
            status.chain = "unknown";
          }
        }
        return JSON.stringify(status);
      }
    }

    // TaskBoard tools (alpha)
    if (taskboardTools.some((t) => t.name === name)) {
      if (!isAlpha()) return ALPHA_REQUIRED_MSG;
      if (!this.hasTaskboard) return "TaskBoard not configured. Set TASK_CHAIN_ID and TASK_CONTRACT_ADDRESS in .env";
      return executeTaskboardTool(name, input, this.env, this.workspaceDir);
    }

    // Portfolio tools (alpha)
    if (portfolioTools.some((t) => t.name === name)) {
      if (!isAlpha()) return ALPHA_REQUIRED_MSG;
      if (!this.hasWriteAccess) return "Write access not configured. Set up a wallet and TASK_CHAIN_ID in .env";
      return executePortfolioTool(name, input, this.env);
    }

    throw new Error(`Unknown onchain tool: ${name}`);
  }
}
