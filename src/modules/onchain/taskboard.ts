import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toBytes, parseEther, formatEther } from "viem";
import type { ToolDefinition } from "../types.js";
import { getClients, explorerTxUrl } from "./chains.js";

/* ── Local task persistence ─────────────────────────────────────────── */

interface StoredTask {
  taskId: number;
  description: string;
  emailKeyword: string;
  rewardEth: string;
  approvalMode: string;
  judgingCriteria?: string;
  deadlineHours: number | string;
  chain: string;
  createdAt: string;
}

function tasksFilePath(workspaceDir: string): string {
  return join(workspaceDir, "memory", "tasks.json");
}

function loadTasks(workspaceDir?: string): StoredTask[] {
  if (!workspaceDir) return [];
  try {
    const raw = readFileSync(tasksFilePath(workspaceDir), "utf-8");
    return JSON.parse(raw) as StoredTask[];
  } catch {
    return [];
  }
}

function saveTask(task: StoredTask, workspaceDir?: string): void {
  if (!workspaceDir) return;
  const tasks = loadTasks(workspaceDir);
  tasks.push(task);
  const dir = join(workspaceDir, "memory");
  mkdirSync(dir, { recursive: true });
  writeFileSync(tasksFilePath(workspaceDir), JSON.stringify(tasks, null, 2));
}

const TASK_BOARD_ABI = [
  {
    name: "createTask",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "descriptionHash", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "approvalMode", type: "uint8" },
    ],
    outputs: [{ name: "taskId", type: "uint256" }],
  },
  {
    name: "approveSubmission",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "submissionIndex", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "cancelTask",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "submitOnBehalfOf",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "contentHash", type: "bytes32" },
      { name: "contributor", type: "address" },
    ],
    outputs: [{ name: "submissionIndex", type: "uint256" }],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "getTask",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      { name: "descriptionHash", type: "bytes32" },
      { name: "reward", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "approvalMode", type: "uint8" },
      { name: "status", type: "uint8" },
      { name: "createdAt", type: "uint256" },
      { name: "winner", type: "address" },
      { name: "submissionCount", type: "uint256" },
    ],
  },
  {
    name: "getSubmission",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "submissionIndex", type: "uint256" },
    ],
    outputs: [
      { name: "contributor", type: "address" },
      { name: "contentHash", type: "bytes32" },
      { name: "submittedAt", type: "uint256" },
    ],
  },
  {
    name: "getTaskIdsInRange",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "start", type: "uint256" },
      { name: "end", type: "uint256" },
    ],
    outputs: [{ name: "ids", type: "uint256[]" }],
  },
  {
    name: "taskCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "pendingWithdrawals",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const TASK_STATUS = ["Open", "Completed", "Cancelled"] as const;

export const taskboardTools: ToolDefinition[] = [
  {
    name: "create_task",
    description:
      "Create a new task on the TaskBoard contract, funded with ETH from the CEO wallet. A unique email keyword is auto-generated — contributors must include it in their email subject line when submitting deliverables. If a required parameter is missing, ask the founder before calling.",
    input_schema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Clear description of the work to be done. Use the founder's exact words — do not rephrase.",
        },
        reward_eth: {
          type: "string",
          description: 'ETH amount to fund (e.g. "0.001"). Must be explicitly provided by the founder.',
        },
        approval_mode: {
          type: "string",
          description: 'Who approves submissions — "ceo" or "founder". Must be explicitly specified.',
        },
        judging_criteria: {
          type: "string",
          description:
            'When approval_mode is "ceo", the founder\'s natural-language description of what makes a good submission. Use the founder\'s exact words.',
        },
        deadline_hours: {
          type: "number",
          description: "Hours until deadline. 0 or omitted = no deadline.",
        },
      },
      required: ["description", "reward_eth", "approval_mode"],
    },
  },
  {
    name: "approve_task_submission",
    description:
      "Approve a submission for a task. This allocates the escrowed ETH to the contributor's pending balance — they call withdraw() to claim. Only works for tasks where approval_mode is 'ceo'.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The task ID" },
        submission_index: {
          type: "number",
          description: "Which submission to approve (0-indexed)",
        },
      },
      required: ["task_id", "submission_index"],
    },
  },
  {
    name: "cancel_task",
    description:
      "Cancel an open task and refund escrowed ETH to the CEO wallet.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The task ID to cancel" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "get_open_tasks",
    description: "List all currently open tasks from the TaskBoard contract.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_task_submissions",
    description:
      "Get all submissions for a specific task. Use this to review deliverables before approving a winner.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The task ID" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "submit_on_behalf_of",
    description:
      "REQUIRED STEP after picking a task winner. Contributors submit via email, NOT onchain. The CEO must call this tool to record the winning contributor's submission onchain, then call approve_task_submission to release the reward. Never tell contributors to submit onchain themselves — the CEO handles all onchain submission via this tool.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The task ID" },
        contributor_address: {
          type: "string",
          description: "The contributor's Ethereum address (from their email)",
        },
        content_hash: {
          type: "string",
          description: "keccak256 hash of the deliverable content (bytes32 hex string). If not provided, one will be generated from the contributor address and timestamp.",
        },
      },
      required: ["task_id", "contributor_address"],
    },
  },
  {
    name: "review_task_submissions",
    description:
      "Review all submissions for a CEO-approved task. Fetches the stored task details, judging criteria, and onchain submissions. After evaluating, you MUST: (1) call submit_on_behalf_of with the winner's wallet address to record their submission onchain, (2) call approve_task_submission to release the reward. Contributors submit via email only — the CEO records submissions onchain on their behalf. NEVER tell contributors to submit onchain themselves.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The task ID to review" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "check_pending_withdrawal",
    description:
      "Check how much ETH a contributor has available to withdraw from the TaskBoard contract.",
    input_schema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The contributor's Ethereum address",
        },
      },
      required: ["address"],
    },
  },
];

export async function executeTaskboardTool(
  name: string,
  input: Record<string, unknown>,
  env: Record<string, string>,
  workspaceDir?: string,
): Promise<string> {
  const contractAddress = env.TASK_CONTRACT_ADDRESS as `0x${string}`;
  if (!contractAddress) {
    return JSON.stringify({
      error: true,
      message: "TASK_CONTRACT_ADDRESS not set",
    });
  }

  try {
    switch (name) {
      case "create_task":
        return await createTask(
          contractAddress,
          input.description as string,
          input.reward_eth as string,
          input.approval_mode as string,
          input.judging_criteria as string | undefined,
          input.deadline_hours as number | undefined,
          env,
          workspaceDir,
        );
      case "approve_task_submission":
        return await approveTaskSubmission(
          contractAddress,
          input.task_id as number,
          input.submission_index as number,
          env,
        );
      case "submit_on_behalf_of":
        return await submitOnBehalfOf(
          contractAddress,
          input.task_id as number,
          input.contributor_address as string,
          input.content_hash as string | undefined,
          env,
        );
      case "cancel_task":
        return await cancelTask(
          contractAddress,
          input.task_id as number,
          env,
        );
      case "get_open_tasks":
        return await getOpenTasks(contractAddress, env, workspaceDir);
      case "get_task_submissions":
        return await getTaskSubmissions(
          contractAddress,
          input.task_id as number,
          env,
        );
      case "review_task_submissions":
        return await reviewTaskSubmissions(
          contractAddress,
          input.task_id as number,
          env,
          workspaceDir,
        );
      case "check_pending_withdrawal":
        return await checkPendingWithdrawal(
          contractAddress,
          input.address as string,
          env,
        );
      default:
        throw new Error(`Unknown taskboard tool: ${name}`);
    }
  } catch (error: unknown) {
    const msg =
      error instanceof Error
        ? (error as { shortMessage?: string }).shortMessage || error.message
        : "Unknown error";
    return JSON.stringify({ error: true, message: `Failed: ${msg}` });
  }
}

async function createTask(
  contractAddress: `0x${string}`,
  description: string,
  rewardEth: string,
  approvalMode: string,
  judgingCriteria: string | undefined,
  deadlineHours: number | undefined,
  env: Record<string, string>,
  workspaceDir?: string,
): Promise<string> {
  const { chain, account, walletClient, publicClient } = getClients(env);

  // Generate a unique email keyword for submission delivery
  const keyword = `TASK-${randomBytes(4).toString("hex").toUpperCase()}`;
  const fullDescription = `${description}\n\nSubmit deliverables by email with subject keyword: ${keyword}\nInclude your Ethereum address in the email body to receive payment.`;

  const descriptionHash = keccak256(toBytes(fullDescription));
  const deadline = deadlineHours
    ? BigInt(Math.floor(Date.now() / 1000) + deadlineHours * 3600)
    : 0n;
  const mode = approvalMode.toLowerCase() === "founder" ? 1 : 0;

  const hash = await walletClient.writeContract({
    chain,
    account,
    address: contractAddress,
    abi: TASK_BOARD_ABI,
    functionName: "createTask",
    args: [descriptionHash, deadline, mode],
    value: parseEther(rewardEth),
  });

  await publicClient.waitForTransactionReceipt({ hash });

  const count = await publicClient.readContract({
    address: contractAddress,
    abi: TASK_BOARD_ABI,
    functionName: "taskCount",
  });
  const taskId = Number(count) - 1;

  saveTask(
    {
      taskId,
      description: fullDescription,
      emailKeyword: keyword,
      rewardEth,
      approvalMode,
      ...(judgingCriteria ? { judgingCriteria } : {}),
      deadlineHours: deadlineHours || "none",
      chain: chain.name,
      createdAt: new Date().toISOString(),
    },
    workspaceDir,
  );

  return JSON.stringify({
    taskId,
    description: fullDescription,
    emailKeyword: keyword,
    emailSearchHint: `Search Gmail for subject:${keyword} to find submissions`,
    rewardEth,
    approvalMode,
    deadlineHours: deadlineHours || "none",
    txHash: hash,
    explorerUrl: explorerTxUrl(chain, hash),
    chain: chain.name,
    submissionInstructions: [
      `IMPORTANT: Share these instructions with contributors:`,
      ``,
      `To submit your work for this task:`,
      `1. Send an email to the CEO's Gmail address`,
      `2. Subject line MUST contain the keyword: ${keyword}`,
      `3. Include your Ethereum wallet address in the email body (this is where payment will be sent)`,
      `4. Attach or describe your deliverable in the email body`,
      ``,
      `Reward: ${rewardEth} ETH | Deadline: ${deadlineHours ? `${deadlineHours} hours` : "none"}`,
    ].join("\n"),
  });
}

async function approveTaskSubmission(
  contractAddress: `0x${string}`,
  taskId: number,
  submissionIndex: number,
  env: Record<string, string>,
): Promise<string> {
  const { chain, account, walletClient, publicClient } = getClients(env);

  const [contributor, , ] = await publicClient.readContract({
    address: contractAddress,
    abi: TASK_BOARD_ABI,
    functionName: "getSubmission",
    args: [BigInt(taskId), BigInt(submissionIndex)],
  });

  const taskData = await publicClient.readContract({
    address: contractAddress,
    abi: TASK_BOARD_ABI,
    functionName: "getTask",
    args: [BigInt(taskId)],
  });
  const reward = taskData[1];

  const hash = await walletClient.writeContract({
    chain,
    account,
    address: contractAddress,
    abi: TASK_BOARD_ABI,
    functionName: "approveSubmission",
    args: [BigInt(taskId), BigInt(submissionIndex)],
  });

  await publicClient.waitForTransactionReceipt({ hash });

  return JSON.stringify({
    taskId,
    submissionIndex,
    winner: contributor,
    rewardEth: formatEther(reward),
    status:
      "approved — contributor can now withdraw funds by calling withdraw() on the contract",
    txHash: hash,
    explorerUrl: explorerTxUrl(chain, hash),
    chain: chain.name,
  });
}

async function submitOnBehalfOf(
  contractAddress: `0x${string}`,
  taskId: number,
  contributorAddress: string,
  contentHash: string | undefined,
  env: Record<string, string>,
): Promise<string> {
  const { chain, account, walletClient, publicClient } = getClients(env);

  // Generate a content hash if not provided
  const hash = contentHash
    ? (contentHash as `0x${string}`)
    : keccak256(toBytes(`${contributorAddress}-${taskId}-${Date.now()}`));

  const txHash = await walletClient.writeContract({
    chain,
    account,
    address: contractAddress,
    abi: TASK_BOARD_ABI,
    functionName: "submitOnBehalfOf",
    args: [BigInt(taskId), hash, contributorAddress as `0x${string}`],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Get the new submission count to determine the index
  const taskData = await publicClient.readContract({
    address: contractAddress,
    abi: TASK_BOARD_ABI,
    functionName: "getTask",
    args: [BigInt(taskId)],
  });
  const submissionIndex = Number(taskData[7]) - 1;

  return JSON.stringify({
    taskId,
    submissionIndex,
    contributor: contributorAddress,
    contentHash: hash,
    status: "submitted — now call approve_task_submission to approve this submission",
    txHash,
    explorerUrl: explorerTxUrl(chain, txHash),
    chain: chain.name,
  });
}

async function cancelTask(
  contractAddress: `0x${string}`,
  taskId: number,
  env: Record<string, string>,
): Promise<string> {
  const { chain, account, walletClient, publicClient } = getClients(env);

  const hash = await walletClient.writeContract({
    chain,
    account,
    address: contractAddress,
    abi: TASK_BOARD_ABI,
    functionName: "cancelTask",
    args: [BigInt(taskId)],
  });

  await publicClient.waitForTransactionReceipt({ hash });

  return JSON.stringify({
    taskId,
    status: "cancelled — escrowed ETH refunded",
    txHash: hash,
    explorerUrl: explorerTxUrl(chain, hash),
    chain: chain.name,
  });
}

async function getOpenTasks(
  contractAddress: `0x${string}`,
  env: Record<string, string>,
  workspaceDir?: string,
): Promise<string> {
  const { chain, publicClient } = getClients(env);

  const count = await publicClient.readContract({
    address: contractAddress,
    abi: TASK_BOARD_ABI,
    functionName: "taskCount",
  });

  const total = Number(count);
  if (total === 0) return JSON.stringify({ tasks: [], chain: chain.name });

  const ids = await publicClient.readContract({
    address: contractAddress,
    abi: TASK_BOARD_ABI,
    functionName: "getTaskIdsInRange",
    args: [0n, BigInt(total)],
  });

  const storedTasks = loadTasks(workspaceDir);
  const storedByIdMap = new Map(storedTasks.map((t) => [t.taskId, t]));

  const openTasks = [];
  for (const id of ids) {
    const taskData = await publicClient.readContract({
      address: contractAddress,
      abi: TASK_BOARD_ABI,
      functionName: "getTask",
      args: [id],
    });
    if (Number(taskData[4]) === 0) {
      const taskId = Number(id);
      const stored = storedByIdMap.get(taskId);
      openTasks.push({
        taskId,
        descriptionHash: taskData[0],
        ...(stored
          ? {
              description: stored.description,
              emailKeyword: stored.emailKeyword,
              ...(stored.judgingCriteria
                ? { judgingCriteria: stored.judgingCriteria }
                : {}),
            }
          : {}),
        rewardEth: formatEther(taskData[1]),
        deadline:
          Number(taskData[2]) === 0
            ? "none"
            : new Date(Number(taskData[2]) * 1000).toISOString(),
        approvalMode: Number(taskData[3]) === 0 ? "CEO" : "Founder",
        submissionCount: Number(taskData[7]),
      });
    }
  }

  return JSON.stringify({ tasks: openTasks, chain: chain.name });
}

async function getTaskSubmissions(
  contractAddress: `0x${string}`,
  taskId: number,
  env: Record<string, string>,
): Promise<string> {
  const { chain, publicClient } = getClients(env);

  const taskData = await publicClient.readContract({
    address: contractAddress,
    abi: TASK_BOARD_ABI,
    functionName: "getTask",
    args: [BigInt(taskId)],
  });

  const submissionCount = Number(taskData[7]);
  const subs = [];

  for (let i = 0; i < submissionCount; i++) {
    const [contributor, contentHash, submittedAt] =
      await publicClient.readContract({
        address: contractAddress,
        abi: TASK_BOARD_ABI,
        functionName: "getSubmission",
        args: [BigInt(taskId), BigInt(i)],
      });
    subs.push({
      submissionIndex: i,
      contributor,
      contentHash,
      submittedAt: new Date(Number(submittedAt) * 1000).toISOString(),
    });
  }

  return JSON.stringify({
    taskId,
    rewardEth: formatEther(taskData[1]),
    status: TASK_STATUS[Number(taskData[4])],
    approvalMode: Number(taskData[3]) === 0 ? "CEO" : "Founder",
    submissions: subs,
    chain: chain.name,
  });
}

async function reviewTaskSubmissions(
  contractAddress: `0x${string}`,
  taskId: number,
  env: Record<string, string>,
  workspaceDir?: string,
): Promise<string> {
  const { chain, publicClient } = getClients(env);

  // Get onchain task data
  const taskData = await publicClient.readContract({
    address: contractAddress,
    abi: TASK_BOARD_ABI,
    functionName: "getTask",
    args: [BigInt(taskId)],
  });

  const status = Number(taskData[4]);
  if (status !== 0) {
    return JSON.stringify({
      error: true,
      message: `Task ${taskId} is ${TASK_STATUS[status]}, not Open`,
    });
  }

  const approvalMode = Number(taskData[3]) === 0 ? "CEO" : "Founder";
  if (approvalMode !== "CEO") {
    return JSON.stringify({
      error: true,
      message: `Task ${taskId} uses Founder approval — only the founder can approve via the contract directly`,
    });
  }

  // Get onchain submissions
  const submissionCount = Number(taskData[7]);
  const submissions = [];
  for (let i = 0; i < submissionCount; i++) {
    const [contributor, contentHash, submittedAt] =
      await publicClient.readContract({
        address: contractAddress,
        abi: TASK_BOARD_ABI,
        functionName: "getSubmission",
        args: [BigInt(taskId), BigInt(i)],
      });
    submissions.push({
      submissionIndex: i,
      contributor,
      contentHash,
      submittedAt: new Date(Number(submittedAt) * 1000).toISOString(),
    });
  }

  // Get stored task data (description, keyword, judging criteria)
  const storedTasks = loadTasks(workspaceDir);
  const stored = storedTasks.find((t) => t.taskId === taskId);

  const result: Record<string, unknown> = {
    taskId,
    rewardEth: formatEther(taskData[1]),
    deadline:
      Number(taskData[2]) === 0
        ? "none"
        : new Date(Number(taskData[2]) * 1000).toISOString(),
    approvalMode,
    submissionCount,
    submissions,
    chain: chain.name,
  };

  if (stored) {
    result.description = stored.description;
    result.emailKeyword = stored.emailKeyword;
    result.judgingCriteria = stored.judgingCriteria || "No specific criteria set — use your best judgment.";
    result.nextSteps = [
      `1. Search Gmail for emails matching: subject:${stored.emailKeyword}`,
      "2. Read each email to review the deliverable content and extract the contributor's ETH wallet address",
      "3. Evaluate each submission against the judging criteria",
      "4. IMMEDIATELY call submit_on_behalf_of(task_id, winner_wallet_address) — YOU record the submission onchain, NOT the contributor",
      "5. IMMEDIATELY call approve_task_submission(task_id, submission_index) with the index returned from step 4",
      "IMPORTANT: Do NOT tell contributors to submit onchain. You handle all onchain operations on their behalf.",
    ];
  } else {
    result.description = "(not available — task was created in a previous session without local persistence)";
    result.nextSteps = [
      "1. Review the onchain submissions above, or search Gmail for email deliverables",
      "2. IMMEDIATELY call submit_on_behalf_of(task_id, winner_wallet_address) — YOU record the submission onchain, NOT the contributor",
      "3. IMMEDIATELY call approve_task_submission(task_id, submission_index) with the index returned from step 2",
      "IMPORTANT: Do NOT tell contributors to submit onchain. You handle all onchain operations on their behalf.",
    ];
  }

  return JSON.stringify(result);
}

async function checkPendingWithdrawal(
  contractAddress: `0x${string}`,
  address: string,
  env: Record<string, string>,
): Promise<string> {
  const { chain, publicClient } = getClients(env);

  const pending = await publicClient.readContract({
    address: contractAddress,
    abi: TASK_BOARD_ABI,
    functionName: "pendingWithdrawals",
    args: [address as `0x${string}`],
  });

  return JSON.stringify({
    address,
    pendingEth: formatEther(pending),
    chain: chain.name,
  });
}
