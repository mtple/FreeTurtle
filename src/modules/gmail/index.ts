import type { FreeTurtleModule, ToolDefinition } from "../types.js";
import {
  createGoogleOAuth2Client,
  type GoogleOAuthCredentials,
} from "../../oauth/google.js";
import { GmailClient } from "./client.js";
import { gmailTools } from "./tools.js";

export class GmailModule implements FreeTurtleModule {
  name = "gmail";
  description = "Read and send emails via Gmail.";

  private client!: GmailClient;

  async initialize(
    _config: Record<string, unknown>,
    env: Record<string, string>,
  ): Promise<void> {
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    const refreshToken = env.GOOGLE_GMAIL_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        "Gmail module requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_GMAIL_REFRESH_TOKEN",
      );
    }

    const creds: GoogleOAuthCredentials = { clientId, clientSecret, refreshToken };
    const auth = createGoogleOAuth2Client(creds);
    this.client = new GmailClient(auth);
  }

  getTools(): ToolDefinition[] {
    return gmailTools;
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    switch (name) {
      case "gmail_read_inbox": {
        const messages = await this.client.listMessages(
          undefined,
          input.max_results as number | undefined,
        );
        return JSON.stringify(messages);
      }
      case "gmail_read_email": {
        const message = await this.client.getMessage(input.id as string);
        return JSON.stringify(message);
      }
      case "gmail_send_email": {
        const result = await this.client.sendMessage(
          input.to as string,
          input.subject as string,
          input.body as string,
        );
        return JSON.stringify(result);
      }
      case "gmail_search": {
        const results = await this.client.searchMessages(
          input.query as string,
          input.max_results as number | undefined,
        );
        return JSON.stringify(results);
      }
      default:
        throw new Error(`Unknown gmail tool: ${name}`);
    }
  }
}
