import { createPublicClient, http, formatEther } from "viem";
import { base } from "viem/chains";

export class OnchainClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private basescanKey?: string;

  constructor(rpcUrl: string, basescanKey?: string) {
    this.client = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });
    this.basescanKey = basescanKey;
  }

  async readContract(
    address: string,
    abi: unknown[],
    functionName: string,
    args?: unknown[]
  ): Promise<unknown> {
    const result = await this.client.readContract({
      address: address as `0x${string}`,
      abi,
      functionName,
      args: args ?? [],
    });
    return result;
  }

  async getBalance(address: string): Promise<string> {
    const balance = await this.client.getBalance({
      address: address as `0x${string}`,
    });
    return formatEther(balance);
  }

  async getTransactions(
    address: string,
    limit = 10
  ): Promise<Record<string, unknown>[]> {
    if (!this.basescanKey) {
      return [{ error: "BASESCAN_API_KEY not set, cannot fetch transactions" }];
    }

    const url = `https://api.basescan.org/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=${limit}&sort=desc&apikey=${this.basescanKey}`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      result: Record<string, unknown>[];
    };

    return (data.result ?? []).map((tx) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      timestamp: tx.timeStamp,
      functionName: tx.functionName,
    }));
  }
}
