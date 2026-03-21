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
import {
  bankrTools,
  executeBankrTool,
} from "./bankr-tools.js";
import { createWalletProvider, type WalletProvider } from "./wallet/index.js";
import { getBankrClient, getCachedBalances } from "./wallet/bankr.js";
import { setCachedAccount, getTaskChain } from "./chains.js";
import { createPublicClient, formatEther, http } from "viem";

export class OnchainModule implements FreeTurtleModule {
  name = "onchain";
  description = "Read smart contracts, balances, and transactions on Base.";

  private client: OnchainClient | null = null;
  private policy?: PolicyConfig;
  private env!: Record<string, string>;
  private hasWriteAccess = false;
  private hasTaskboard = false;
  private hasBankrWallet = false;
  private workspaceDir?: string;
  private walletProvider: WalletProvider | null = null;

  async initialize(
    _config: Record<string, unknown>,
    env: Record<string, string>,
    options?: { policy?: PolicyConfig },
  ): Promise<void> {
    const rpcUrl = env.RPC_URL;
    if (!rpcUrl && !env.BANKR_API_KEY) {
      throw new Error("Onchain module requires RPC_URL (or BANKR_API_KEY for bankr wallet)");
    }
    if (rpcUrl) {
      this.client = new OnchainClient(rpcUrl, env.BLOCK_EXPLORER_API_KEY);
    }
    this.policy = options?.policy;
    this.env = env;
    this.workspaceDir = _config._workspaceDir as string | undefined;

    // Bankr wallet is always available; CDP/private-key wallets are alpha
    if (env.BANKR_API_KEY) {
      try {
        const { createBankrProvider } = await import("./wallet/bankr.js");
        this.walletProvider = await createBankrProvider(env.BANKR_API_KEY);
        this.hasBankrWallet = true;
        console.error(`[INFO] Bankr wallet initialized: ${this.walletProvider.address}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ERROR] Bankr wallet init failed: ${msg}`);
      }
    }

    // Server wallet (CDP/private-key), taskboard, and portfolio are alpha features
    if (isAlpha() && !this.walletProvider) {
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

    if (this.walletProvider) {
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
    }

    if (isAlpha()) {
      if (this.hasTaskboard) {
        tools.push(...taskboardTools);
      }
      if (this.hasWriteAccess) {
        tools.push(...portfolioTools);
      }
    }

    if (this.hasBankrWallet) {
      tools.push(...bankrTools);
    }

    return tools;
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    // Existing read-only tools (require OnchainClient / RPC_URL)
    switch (name) {
      case "read_contract": {
        if (!this.client) return "RPC_URL not configured. Read-only onchain tools require RPC_URL.";
        assertOnchainScopeAllowed(
          this.policy,
          input.address as string,
          input.function_name as string,
        );
        const result = await withRetry(() =>
          this.client!.readContract(
            input.address as string,
            input.abi as unknown[],
            input.function_name as string,
            input.args as unknown[] | undefined,
          ),
        );
        return JSON.stringify(result);
      }
      case "get_balance": {
        if (!this.client) return "RPC_URL not configured. Read-only onchain tools require RPC_URL.";
        const balance = await withRetry(() =>
          this.client!.getBalance(input.address as string),
        );
        return `${balance} ETH`;
      }
      case "get_transactions": {
        if (!this.client) return "RPC_URL not configured. Read-only onchain tools require RPC_URL.";
        const txs = await withRetry(() =>
          this.client!.getTransactions(
            input.address as string,
            (input.limit as number) ?? 10,
          ),
        );
        return JSON.stringify(txs);
      }
      case "wallet_status": {
        if (!this.walletProvider) {
          return "No wallet configured. Set CDP_API_KEY_ID + CDP_API_KEY_SECRET for CDP wallet, CEO_PRIVATE_KEY for private key wallet, or BANKR_API_KEY for bankr wallet.";
        }
        const status: Record<string, string> = {
          provider: this.walletProvider.type,
          address: this.walletProvider.address,
        };
        if (this.walletProvider.type === "bankr") {
          const cached = getCachedBalances();
          if (cached?.solAddress) {
            status.solanaAddress = cached.solAddress;
          }
          status.chains = "Base, Ethereum, Polygon, Unichain, Solana";
          status.capabilities = "Use bankr_prompt to swap, transfer, check prices, deploy tokens. Use bankr_balances to check balances.";
          return JSON.stringify(status);
        }
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

    // Bankr tools
    if (bankrTools.some((t) => t.name === name)) {
      const client = getBankrClient();
      if (!client) return "Bankr wallet not configured. Set BANKR_API_KEY in .env";
      return executeBankrTool(name, input, client);
    }

    throw new Error(`Unknown onchain tool: ${name}`);
  }
}
