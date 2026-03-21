import { toAccount } from "viem/accounts";
import type { WalletProvider } from "./types.js";

const BASE_URL = "https://api.bankr.bot";

// --- Types ---

export interface BankrBalancesResponse {
  success: boolean;
  evmAddress: string;
  solAddress: string;
  balances: Record<
    string,
    {
      nativeBalance: string;
      nativeUsd: string;
      tokenBalances: Array<{
        network: string;
        token: {
          balance: number;
          balanceUSD: number;
          baseToken: {
            name: string;
            address: string;
            symbol: string;
            price: number;
            imgUrl: string;
          };
        };
      }>;
      total: string;
    }
  >;
}

export interface BankrPromptResponse {
  success: boolean;
  jobId: string;
  threadId: string;
  status: string;
  message?: string;
}

export interface BankrJobResponse {
  success: boolean;
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  prompt?: string;
  response?: string;
  processingTime?: number;
}

interface BankrSignResponse {
  success: boolean;
  signature: `0x${string}`;
  signer: string;
  signatureType: string;
}

// --- Client ---

export class BankrWalletClient {
  constructor(private apiKey: string) {}

  private async request<T>(
    path: string,
    options?: RequestInit,
  ): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
        ...options?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bankr API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async getBalances(chains?: string[]): Promise<BankrBalancesResponse> {
    const query = chains?.length ? `?chains=${chains.join(",")}` : "";
    return this.request<BankrBalancesResponse>(`/agent/balances${query}`);
  }

  async prompt(
    text: string,
    threadId?: string,
  ): Promise<BankrPromptResponse> {
    return this.request<BankrPromptResponse>("/agent/prompt", {
      method: "POST",
      body: JSON.stringify({ prompt: text, ...(threadId && { threadId }) }),
    });
  }

  async getJobStatus(jobId: string): Promise<BankrJobResponse> {
    return this.request<BankrJobResponse>(`/agent/job/${jobId}`);
  }

  async sign(
    request:
      | { signatureType: "personal_sign"; message: string }
      | { signatureType: "eth_signTypedData_v4"; typedData: unknown }
      | { signatureType: "eth_signTransaction"; transaction: unknown },
  ): Promise<BankrSignResponse> {
    return this.request<BankrSignResponse>("/agent/sign", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }
}

// Module-level client singleton (set during createBankrProvider)
let _client: BankrWalletClient | null = null;
let _cachedBalances: BankrBalancesResponse | null = null;

export function getBankrClient(): BankrWalletClient | null {
  return _client;
}

export function getCachedBalances(): BankrBalancesResponse | null {
  return _cachedBalances;
}

export async function createBankrProvider(
  apiKey: string,
): Promise<WalletProvider> {
  const client = new BankrWalletClient(apiKey);
  _client = client;

  // Fetch balances to get wallet addresses
  const balances = await client.getBalances();
  _cachedBalances = balances;
  const address = balances.evmAddress as `0x${string}`;

  const account = toAccount({
    address,
    signMessage: async ({ message }) => {
      const res = await client.sign({
        signatureType: "personal_sign",
        message: typeof message === "string" ? message : message.raw.toString(),
      });
      return res.signature;
    },
    signTransaction: async (transaction) => {
      const res = await client.sign({
        signatureType: "eth_signTransaction",
        transaction,
      });
      return res.signature;
    },
    signTypedData: async (typedData) => {
      const res = await client.sign({
        signatureType: "eth_signTypedData_v4",
        typedData,
      });
      return res.signature;
    },
  });

  return {
    type: "bankr",
    account,
    address,
  };
}
