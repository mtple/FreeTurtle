import type { ToolDefinition } from "../types.js";

export const gmailTools: ToolDefinition[] = [
  {
    name: "gmail_read_inbox",
    description: "Read recent emails from the inbox. Returns a list of email summaries (id, from, subject, date, snippet).",
    input_schema: {
      type: "object",
      properties: {
        max_results: {
          type: "number",
          description: "Maximum number of emails to return (default: 10)",
        },
      },
    },
  },
  {
    name: "gmail_read_email",
    description: "Read the full content of a specific email by its ID. Returns the complete email with headers and body.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The Gmail message ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "gmail_send_email",
    description: "Send an email from the CEO's Gmail account.",
    input_schema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address",
        },
        subject: {
          type: "string",
          description: "Email subject line",
        },
        body: {
          type: "string",
          description: "Email body (plain text)",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_search",
    description: "Search emails using Gmail search syntax (e.g. 'from:alice subject:meeting after:2024/01/01'). Returns matching email summaries.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Gmail search query",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results (default: 10)",
        },
      },
      required: ["query"],
    },
  },
];
