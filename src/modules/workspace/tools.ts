import type { ToolDefinition } from "../types.js";

export const workspaceTools: ToolDefinition[] = [
  {
    name: "read_file",
    description:
      "Read a file from your workspace. Use this to read your own soul.md, config.md, memory files, or any other workspace file. Paths are relative to the workspace root (~/.freeturtle/).",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path to read (e.g. 'soul.md', 'config.md', 'workspace/memory/posting-log.json')",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write or overwrite a file in your workspace. Use this to modify your own soul.md (identity, voice, goals), config.md (modules, cron schedules, channels), memory files, or create new files. Paths are relative to the workspace root (~/.freeturtle/). Writing to soul.md, config.md, or .env requires founder approval.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path to write (e.g. 'soul.md', 'config.md', 'workspace/notes.md')",
        },
        content: {
          type: "string",
          description: "The full content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Edit a file by replacing a specific string with new content. More precise than write_file when you only need to change part of a file. Paths are relative to the workspace root (~/.freeturtle/). Editing soul.md, config.md, or .env requires founder approval.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to edit",
        },
        old_text: {
          type: "string",
          description: "The exact text to find and replace",
        },
        new_text: {
          type: "string",
          description: "The replacement text",
        },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "list_files",
    description:
      "List files and directories in your workspace. Paths are relative to the workspace root (~/.freeturtle/).",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative directory path to list (default: root). e.g. 'workspace/memory'",
        },
      },
      required: [],
    },
  },
  {
    name: "reload_config",
    description:
      "Hot-reload config.md without restarting the daemon. Call this after editing config.md so changes (cron schedules, heartbeat settings) take effect immediately. No restart needed.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "restart_daemon",
    description:
      "Gracefully restart the FreeTurtle daemon. Spawns a new process, then exits the current one. Use when a full restart is needed (e.g. module/channel changes, .env changes). For cron/heartbeat changes, prefer reload_config instead.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "append_memory",
    description:
      "Append a note to today's daily memory file (workspace/memory/YYYY-MM-DD.md). Use this to record observations, decisions, important context, and learnings during tasks. No approval required.",
    input_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The note to append to today's daily memory",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_search",
    description:
      "Search your memory files — daily logs, long-term memory, session notes, reflections, and strategy docs. Use this before answering questions about prior work, decisions, or history.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query — keywords to find in memory files",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 10)",
        },
      },
      required: ["query"],
    },
  },
];
