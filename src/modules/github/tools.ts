import type { ToolDefinition } from "../types.js";

export const githubTools: ToolDefinition[] = [
  {
    name: "create_issue",
    description: "Create a new issue on a GitHub repository.",
    input_schema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository in owner/name format (e.g. 'tortoise-club/FreeTurtle')",
        },
        title: {
          type: "string",
          description: "Issue title",
        },
        body: {
          type: "string",
          description: "Issue body (markdown supported)",
        },
      },
      required: ["repo", "title", "body"],
    },
  },
  {
    name: "list_issues",
    description: "List issues for a GitHub repository.",
    input_schema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository in owner/name format",
        },
        state: {
          type: "string",
          enum: ["open", "closed", "all"],
          description: "Filter by state (default: open)",
        },
      },
      required: ["repo"],
    },
  },
  {
    name: "commit_file",
    description:
      "Create or update a file in a GitHub repository via a commit. Writes to non-main branches are allowed if in scope. Writes to main require owner approval.",
    input_schema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository in owner/name format",
        },
        path: {
          type: "string",
          description: "File path in the repo (e.g. 'strategy/2026-03-02.md')",
        },
        content: {
          type: "string",
          description: "The file content to write",
        },
        message: {
          type: "string",
          description: "Commit message",
        },
        branch: {
          type: "string",
          description: "Target branch (default: main). Non-main branches do not require approval.",
        },
      },
      required: ["repo", "path", "content", "message"],
    },
  },
];
