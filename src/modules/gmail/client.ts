import { gmail as gmailApi, type gmail_v1 } from "@googleapis/gmail";
import type { OAuth2Client } from "google-auth-library";

export class GmailClient {
  private gmail: gmail_v1.Gmail;

  constructor(auth: OAuth2Client) {
    this.gmail = gmailApi({ version: "v1", auth });
  }

  /**
   * Get the authenticated user's profile (email, messagesTotal, etc.).
   * Useful as a connection test.
   */
  async getProfile(): Promise<{ email: string; messagesTotal: number }> {
    const res = await this.gmail.users.getProfile({ userId: "me" });
    return {
      email: res.data.emailAddress!,
      messagesTotal: res.data.messagesTotal ?? 0,
    };
  }

  /**
   * Get send-as aliases. Primary entry contains the account's display name.
   */
  async getSendAs(): Promise<{ displayName?: string; email: string; isPrimary?: boolean }[]> {
    const res = await this.gmail.users.settings.sendAs.list({ userId: "me" });
    return (res.data.sendAs || []).map((s) => ({
      displayName: s.displayName || undefined,
      email: s.sendAsEmail!,
      isPrimary: s.isPrimary || false,
    }));
  }

  /**
   * List messages from inbox (or with a query).
   */
  async listMessages(
    query?: string,
    maxResults?: number,
  ): Promise<{ id: string; threadId: string; from: string; subject: string; date: string; snippet: string }[]> {
    const res = await this.gmail.users.messages.list({
      userId: "me",
      q: query || "in:inbox",
      maxResults: maxResults ?? 10,
    });

    const ids = res.data.messages || [];
    if (ids.length === 0) return [];

    // Fetch message details in parallel (N+1 pattern, same as OpenClaw)
    const messages = await Promise.all(
      ids.map(async (m) => {
        try {
          const detail = await this.gmail.users.messages.get({
            userId: "me",
            id: m.id!,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          });
          return detail.data;
        } catch {
          return null;
        }
      }),
    );

    return messages
      .filter((m): m is gmail_v1.Schema$Message => m !== null)
      .map((msg) => {
        const headers = msg.payload?.headers || [];
        const getH = (n: string) =>
          headers.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value || "";
        return {
          id: msg.id!,
          threadId: msg.threadId!,
          from: getH("From"),
          subject: getH("Subject"),
          date: getH("Date"),
          snippet: msg.snippet || "",
        };
      });
  }

  /**
   * Get a full message by ID, including parsed body.
   */
  async getMessage(id: string): Promise<{
    id: string;
    threadId: string;
    from: string;
    to: string;
    subject: string;
    date: string;
    body: string;
    labels: string[];
  }> {
    const res = await this.gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });

    const msg = res.data;
    const headers = msg.payload?.headers || [];
    const getH = (n: string) =>
      headers.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value || "";

    const body = extractPlainText(msg.payload ?? {});

    return {
      id: msg.id!,
      threadId: msg.threadId!,
      from: getH("From"),
      to: getH("To"),
      subject: getH("Subject"),
      date: getH("Date"),
      body,
      labels: msg.labelIds || [],
    };
  }

  /**
   * Search messages using Gmail query syntax.
   */
  async searchMessages(
    query: string,
    maxResults?: number,
  ): Promise<{ id: string; threadId: string; from: string; subject: string; date: string; snippet: string }[]> {
    return this.listMessages(query, maxResults);
  }

  /**
   * Send an email.
   */
  async sendMessage(to: string, subject: string, body: string): Promise<{ id: string }> {
    // Build RFC 2822 MIME message
    const messageParts = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "MIME-Version: 1.0",
      "",
      body,
    ];
    const raw = Buffer.from(messageParts.join("\r\n")).toString("base64url");

    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    return { id: res.data.id! };
  }
}

/**
 * Extract plain text body from a Gmail API MessagePart.
 * Matches OpenClaw's extractPlainText pattern.
 */
function extractPlainText(part: gmail_v1.Schema$MessagePart): string {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64").toString("utf-8");
  }
  if (part.parts) {
    if (part.mimeType === "multipart/alternative") {
      const plain = part.parts.find((p) => p.mimeType === "text/plain");
      if (plain) return extractPlainText(plain);
    }
    for (const sub of part.parts) {
      const text = extractPlainText(sub);
      if (text) return text;
    }
  }
  return "";
}
