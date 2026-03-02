import type { ToolDefinition } from "../types.js";

export const farcasterTools: ToolDefinition[] = [
  {
    name: "post_cast",
    description:
      "Post a cast (message) to Farcaster. Optionally post to a specific channel or include embed URLs.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text content of the cast (max 1024 characters)",
        },
        channel_id: {
          type: "string",
          description: "Optional channel to post to (e.g. 'tortoise')",
        },
        embeds: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of URLs to embed (max 2)",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "read_channel",
    description:
      "Read recent casts from a Farcaster channel. Returns the latest posts with author, text, reactions, and reply counts.",
    input_schema: {
      type: "object",
      properties: {
        channel_id: {
          type: "string",
          description: "The channel to read from (e.g. 'tortoise')",
        },
        limit: {
          type: "number",
          description: "Number of casts to return (default 10, max 100)",
        },
      },
      required: ["channel_id"],
    },
  },
  {
    name: "read_mentions",
    description:
      "Read recent notifications and mentions for the operator's Farcaster account.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of mentions to return (default 10, max 100)",
        },
      },
      required: [],
    },
  },
  {
    name: "reply_to_cast",
    description:
      "Reply to a specific cast on Farcaster by its hash.",
    input_schema: {
      type: "object",
      properties: {
        parent_hash: {
          type: "string",
          description: "The hash of the cast to reply to",
        },
        text: {
          type: "string",
          description: "The text content of the reply",
        },
      },
      required: ["parent_hash", "text"],
    },
  },
];
