import type { ToolDefinition } from "../types.js";

export const clawHubTools: ToolDefinition[] = [
  {
    name: "list_skills",
    description:
      "List all installed ClawHub / OpenClaw skills that are currently available. Returns each skill's name, description, and emoji.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "read_skill_instructions",
    description:
      "Read the full instructions (Markdown body) of an installed ClawHub skill. Use this when you need the detailed guidance a skill provides before carrying out a task.",
    input_schema: {
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description: "The name (slug) of the skill to read.",
        },
      },
      required: ["skill_name"],
    },
  },
  {
    name: "run_skill_command",
    description:
      "Execute a shell command in the context of a ClawHub skill. The command is run in the workspace directory. Only binaries declared by the skill's requirements are allowed. Use this when a skill's instructions tell you to run a CLI tool.",
    input_schema: {
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description: "The skill whose declared binaries to allow.",
        },
        command: {
          type: "string",
          description:
            "The shell command to run (e.g. 'curl -s https://api.example.com/data').",
        },
        timeout_ms: {
          type: "number",
          description:
            "Optional timeout in milliseconds (default 30000, max 120000).",
        },
      },
      required: ["skill_name", "command"],
    },
  },
];
