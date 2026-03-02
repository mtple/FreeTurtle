import type { ToolDefinition } from "../types.js";

export const databaseTools: ToolDefinition[] = [
  {
    name: "query_database",
    description:
      "Execute a read-only SQL query against the connected PostgreSQL database. Returns results as JSON. Only SELECT queries are allowed.",
    input_schema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "The SQL query to execute (SELECT only)",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "list_tables",
    description:
      "List all tables in the database with their column names and types.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];
