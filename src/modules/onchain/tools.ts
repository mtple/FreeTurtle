import type { ToolDefinition } from "../types.js";

export const onchainTools: ToolDefinition[] = [
  {
    name: "read_contract",
    description:
      "Read data from a smart contract on Base. Requires the contract ABI for the function being called.",
    input_schema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Contract address (0x...)",
        },
        abi: {
          type: "array",
          description: "ABI array containing at least the function definition",
        },
        function_name: {
          type: "string",
          description: "Name of the function to call",
        },
        args: {
          type: "array",
          description: "Function arguments (optional)",
        },
      },
      required: ["address", "abi", "function_name"],
    },
  },
  {
    name: "get_balance",
    description: "Get the ETH balance of an address on Base.",
    input_schema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Wallet address (0x...)",
        },
      },
      required: ["address"],
    },
  },
  {
    name: "get_transactions",
    description:
      "Get recent transactions for an address on Base (requires BASESCAN_API_KEY).",
    input_schema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Wallet address (0x...)",
        },
        limit: {
          type: "number",
          description: "Number of transactions to return (default 10)",
        },
      },
      required: ["address"],
    },
  },
];
