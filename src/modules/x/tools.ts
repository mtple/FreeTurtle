import type { ToolDefinition } from "../types.js";

export const xTools: ToolDefinition[] = [
  {
    name: "x_post",
    description:
      "Post a tweet on X (formerly Twitter). Max 280 characters.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text content of the tweet (max 280 characters)",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "x_reply",
    description:
      "Reply to a specific tweet on X by its ID.",
    input_schema: {
      type: "object",
      properties: {
        tweet_id: {
          type: "string",
          description: "The ID of the tweet to reply to",
        },
        text: {
          type: "string",
          description: "The text content of the reply (max 280 characters)",
        },
      },
      required: ["tweet_id", "text"],
    },
  },
  {
    name: "x_delete",
    description:
      "Delete a tweet by its ID. This action requires founder approval and cannot be undone.",
    input_schema: {
      type: "object",
      properties: {
        tweet_id: {
          type: "string",
          description: "The ID of the tweet to delete",
        },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "x_get_tweet",
    description:
      "Fetch a single tweet by ID. Returns text, author, engagement metrics, and timestamp.",
    input_schema: {
      type: "object",
      properties: {
        tweet_id: {
          type: "string",
          description: "The tweet ID to fetch",
        },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "x_timeline",
    description:
      "Read recent tweets from a user's timeline by their user ID.",
    input_schema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "The X user ID to read timeline from",
        },
        limit: {
          type: "number",
          description: "Number of tweets to return (default 10, max 100)",
        },
      },
      required: ["user_id"],
    },
  },
  {
    name: "x_search",
    description:
      "Search recent tweets (last 7 days) by query. Use this to find mentions, conversations, or topics.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g. keyword, @username, #hashtag)",
        },
        limit: {
          type: "number",
          description: "Number of results (default 10, max 100)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "x_me",
    description:
      "Get the authenticated X account's user ID, username, and display name.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];
