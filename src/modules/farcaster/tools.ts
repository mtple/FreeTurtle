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
      "Read recent notifications and mentions for the CEO's Farcaster account.",
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
  {
    name: "delete_cast",
    description:
      "Delete a cast by its hash. This action requires founder approval and cannot be undone.",
    input_schema: {
      type: "object",
      properties: {
        target_hash: {
          type: "string",
          description: "The hash of the cast to delete",
        },
      },
      required: ["target_hash"],
    },
  },
  {
    name: "fetch_cast",
    description:
      "Fetch a single cast by hash or Farcaster URL. Returns author, text, reactions, replies, embeds, and timestamp.",
    input_schema: {
      type: "object",
      properties: {
        identifier: {
          type: "string",
          description: "Cast hash (0x...) or Farcaster URL",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "search_casts",
    description:
      "Search Farcaster casts by query text. Use this to find mentions, conversations, or specific topics.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g. username, topic, URL)",
        },
        limit: {
          type: "number",
          description: "Number of results (default 20, max 100)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "check_cast_engagement",
    description:
      "Check engagement stats (likes, recasts, replies) for a specific cast. Useful for tracking how a post is performing.",
    input_schema: {
      type: "object",
      properties: {
        hash: {
          type: "string",
          description: "The cast hash to check engagement for",
        },
      },
      required: ["hash"],
    },
  },
  {
    name: "check_user",
    description:
      "Look up a Farcaster user by FID. Returns username, display name, follower count, and spam score.",
    input_schema: {
      type: "object",
      properties: {
        fid: {
          type: "number",
          description: "The Farcaster FID of the user to look up",
        },
      },
      required: ["fid"],
    },
  },
];
