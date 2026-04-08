import { ethers } from "ethers";
import { logger } from "../logger.js";
import { LLMTool } from "../llm.js";
import { getConfig } from "../config.js";

// Task Board ABI for interacting with the task management contract
const TASK_BOARD_ABI = [
  "function createTask(string memory title, string memory description, uint256 expiryTimestamp) external payable returns (uint256 taskId)",
  "function getTask(uint256 taskId) external view returns (string memory title, string memory description, uint256 reward, uint256 expiry, address creator, bool completed)",
  "function getAllTasks() external view returns (uint256[] memory)",
  "function submitContribution(uint256 taskId, string memory submissionData, address contributor) external",
  "function approveTask(uint256 taskId, uint256 submissionIndex) external",
  "function getTaskSubmissions(uint256 taskId) external view returns (address[] memory contributors, string[] memory submissions)",
  "event TaskCreated(uint256 indexed taskId, string title, uint256 reward)",
  "event TaskCompleted(uint256 indexed taskId, address contributor, uint256 reward)"
];

// Default Task Board contract address (can be overridden in config)
const DEFAULT_TASK_BOARD_ADDRESS = "0x1234567890123456789012345678901234567890"; // Placeholder

export function getOnchainTools(): LLMTool[] {
  const config = getConfig();
  
  if (!config.onchain?.privateKey) {
    logger.debug("Onchain module: no private key configured, skipping");
    return [];
  }

  return [
    {
      name: "read_contract",
      description: "Read data from a smart contract",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Contract address" },
          abi: { type: "array", description: "Contract ABI (JSON array)" },
          method: { type: "string", description: "Method name to call" },
          args: { type: "array", description: "Arguments for the method call" }
        },
        required: ["address", "abi", "method"]
      }
    },
    {
      name: "send_transaction",
      description: "Send a transaction to a smart contract",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Contract address" },
          abi: { type: "array", description: "Contract ABI (JSON array)" },
          method: { type: "string", description: "Method name to call" },
          args: { type: "array", description: "Arguments for the method call" },
          value: { type: "string", description: "ETH value to send (in wei)" }
        },
        required: ["address", "abi", "method"]
      }
    },
    {
      name: "get_balance",
      description: "Get ETH balance of an address",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Address to check balance for" }
        },
        required: ["address"]
      }
    },
    {
      name: "create_task",
      description: "Create a new task on the Task Board with ETH reward",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
          description: { type: "string", description: "Detailed task description" },
          reward_eth: { type: "string", description: "Reward amount in ETH (e.g. '0.1')" },
          expiry_hours: { type: "number", description: "Hours until task expires (default 168 = 1 week)" }
        },
        required: ["title", "description", "reward_eth"]
      }
    },
    {
      name: "list_tasks",
      description: "List all tasks on the Task Board",
      parameters: {
        type: "object",
        properties: {
          include_completed: { type: "boolean", description: "Include completed tasks (default false)" }
        }
      }
    },
    {
      name: "submit_on_behalf_of",
      description: "Submit a contribution to a task on behalf of a contributor",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID" },
          contributor_address: { type: "string", description: "Address of the contributor" },
          submission_data: { type: "string", description: "Description or link to the contribution" }
        },
        required: ["task_id", "contributor_address", "submission_data"]
      }
    },
    {
      name: "approve_task",
      description: "Approve a task submission and trigger reward payment",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID" },
          submission_index: { type: "number", description: "Index of the submission to approve (default 0)" }
        },
        required: ["task_id"]
      }
    }
  ];
}

export async function executeOnchainTool(
  tool: string,
  args: any
): Promise<string> {
  const config = getConfig();
  
  if (!config.onchain?.privateKey) {
    throw new Error("Onchain private key not configured");
  }

  const rpcUrl = config.onchain.rpcUrl || "https://eth.llamarpc.com";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(config.onchain.privateKey, provider);
  const taskBoardAddress = config.onchain.taskBoardAddress || DEFAULT_TASK_BOARD_ADDRESS;

  try {
    switch (tool) {
      case "read_contract": {
        const { address, abi, method, args: methodArgs = [] } = args;
        const contract = new ethers.Contract(address, abi, provider);
        const result = await contract[method](...methodArgs);
        return `Contract read result: ${JSON.stringify(result, null, 2)}`;
      }

      case "send_transaction": {
        const { address, abi, method, args: methodArgs = [], value = "0" } = args;
        const contract = new ethers.Contract(address, abi, wallet);
        const tx = await contract[method](...methodArgs, { value });
        const receipt = await tx.wait();
        return `Transaction sent: ${tx.hash}\nStatus: ${receipt.status === 1 ? 'Success' : 'Failed'}\nGas used: ${receipt.gasUsed}`;
      }

      case "get_balance": {
        const { address } = args;
        const balance = await provider.getBalance(address);
        const ethBalance = ethers.formatEther(balance);
        return `Balance for ${address}: ${ethBalance} ETH`;
      }

      case "create_task": {
        const { title, description, reward_eth, expiry_hours = 168 } = args;
        const rewardWei = ethers.parseEther(reward_eth);
        const expiryTimestamp = Math.floor(Date.now() / 1000) + (expiry_hours * 3600);
        
        const taskBoard = new ethers.Contract(taskBoardAddress, TASK_BOARD_ABI, wallet);
        const tx = await taskBoard.createTask(title, description, expiryTimestamp, { value: rewardWei });
        const receipt = await tx.wait();
        
        // Find the TaskCreated event to get the task ID
        const event = receipt.logs.find(log => {
          try {
            const parsed = taskBoard.interface.parseLog(log);
            return parsed?.name === 'TaskCreated';
          } catch {
            return false;
          }
        });
        
        const taskId = event ? taskBoard.interface.parseLog(event).args.taskId : 'unknown';
        
        return `Task created successfully!\nTask ID: ${taskId}\nTitle: ${title}\nReward: ${reward_eth} ETH\nExpires: ${new Date(expiryTimestamp * 1000).toISOString()}\nTransaction: ${tx.hash}`;
      }

      case "list_tasks": {
        const { include_completed = false } = args;
        const taskBoard = new ethers.Contract(taskBoardAddress, TASK_BOARD_ABI, provider);
        
        const taskIds = await taskBoard.getAllTasks();
        const tasks = [];
        
        for (const taskId of taskIds) {
          const [title, description, reward, expiry, creator, completed] = await taskBoard.getTask(taskId);
          
          if (!include_completed && completed) {
            continue;
          }
          
          tasks.push({
            id: taskId.toString(),
            title,
            description,
            reward: ethers.formatEther(reward) + ' ETH',
            expiry: new Date(Number(expiry) * 1000).toISOString(),
            creator,
            completed
          });
        }
        
        return `Found ${tasks.length} tasks:\n${JSON.stringify(tasks, null, 2)}`;
      }

      case "submit_on_behalf_of": {
        const { task_id, contributor_address, submission_data } = args;
        const taskBoard = new ethers.Contract(taskBoardAddress, TASK_BOARD_ABI, wallet);
        
        const tx = await taskBoard.submitContribution(task_id, submission_data, contributor_address);
        const receipt = await tx.wait();
        
        return `Contribution submitted successfully!\nTask ID: ${task_id}\nContributor: ${contributor_address}\nSubmission: ${submission_data}\nTransaction: ${tx.hash}`;
      }

      case "approve_task": {
        const { task_id, submission_index = 0 } = args;
        const taskBoard = new ethers.Contract(taskBoardAddress, TASK_BOARD_ABI, wallet);
        
        const tx = await taskBoard.approveTask(task_id, submission_index);
        const receipt = await tx.wait();
        
        // Find the TaskCompleted event
        const event = receipt.logs.find(log => {
          try {
            const parsed = taskBoard.interface.parseLog(log);
            return parsed?.name === 'TaskCompleted';
          } catch {
            return false;
          }
        });
        
        if (event) {
          const { contributor, reward } = taskBoard.interface.parseLog(event).args;
          return `Task approved and payment sent!\nTask ID: ${task_id}\nContributor: ${contributor}\nReward: ${ethers.formatEther(reward)} ETH\nTransaction: ${tx.hash}`;
        }
        
        return `Task approved!\nTask ID: ${task_id}\nTransaction: ${tx.hash}`;
      }

      default:
        throw new Error(`Unknown onchain tool: ${tool}`);
    }
  } catch (error) {
    logger.error(`Onchain tool ${tool} failed:`, error);
    throw error;
  }
}