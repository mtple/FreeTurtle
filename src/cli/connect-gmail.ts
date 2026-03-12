import * as p from "@clack/prompts";
import { readFile, writeFile, chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { enableModule } from "./config-utils.js";
import {
  runGoogleOAuthFlow,
  createGoogleOAuth2Client,
} from "../oauth/google.js";
import { GmailClient } from "../modules/gmail/client.js";

export interface GmailConnectResult {
  clientId: string;
  clientSecret: string;
  email: string;
}

export async function connectGmail(
  dir: string,
): Promise<GmailConnectResult | null> {
  p.intro("Gmail Setup");

  p.note(
    [
      "We recommend creating a dedicated Google account for your",
      "CEO so emails come from its own identity. You can use this",
      "same Google account to create a GitHub account for the CEO.",
    ].join("\n"),
    "Recommendation",
  );

  const email = await p.text({
    message: "Gmail address for the CEO",
    placeholder: "ceo@gmail.com",
    validate: (v) => {
      if (!v?.trim()) return "Required";
      if (!v.includes("@")) return "Must be a valid email address";
      return undefined;
    },
  });
  if (p.isCancel(email)) {
    p.cancel("Cancelled.");
    return null;
  }

  p.note(
    [
      "To connect Gmail, you need a Google Cloud OAuth client:",
      "",
      "1. Go to console.cloud.google.com/apis/credentials",
      "2. Create a project (or use an existing one)",
      "3. Enable the Gmail API:",
      "   APIs & Services > Library > search 'Gmail API' > Enable",
      "4. Create OAuth 2.0 Client ID:",
      "   Credentials > Create Credentials > OAuth client ID",
      "   Application type: Desktop app",
      "5. Copy the Client ID and Client Secret",
      "",
      "Tip: paste these instructions into an AI chat and ask it",
      "to walk you through step by step.",
    ].join("\n"),
    "Google Cloud Setup",
  );

  const clientId = await p.text({
    message: "OAuth Client ID",
    validate: (v) => (v?.trim() ? undefined : "Required"),
  });
  if (p.isCancel(clientId)) {
    p.cancel("Cancelled.");
    return null;
  }

  const clientSecret = await p.text({
    message: "OAuth Client Secret",
    validate: (v) => (v?.trim() ? undefined : "Required"),
  });
  if (p.isCancel(clientSecret)) {
    p.cancel("Cancelled.");
    return null;
  }

  p.note(
    "A browser window will open for Gmail authorization.\nSign in with the CEO's Google account and grant access.",
    "OAuth Flow",
  );

  const s = p.spinner();
  s.start("Waiting for browser authorization...");

  let refreshToken: string;
  try {
    refreshToken = await runGoogleOAuthFlow(clientId.trim(), clientSecret.trim());
    s.stop("Authorization successful!");
  } catch (err) {
    s.stop("Authorization failed");
    p.log.error(
      `OAuth failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
    return null;
  }

  // Test connection
  s.start("Testing Gmail connection...");
  try {
    const auth = createGoogleOAuth2Client({
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      refreshToken,
    });
    const client = new GmailClient(auth);
    const sendAs = await client.getSendAs();
    const primary = sendAs.find((a) => a.isPrimary) || sendAs[0];
    const displayName = primary?.displayName;
    s.stop(
      displayName
        ? `Connected as ${displayName} (${primary?.email})`
        : `Connected as ${primary?.email || email}`,
    );
  } catch (err) {
    s.stop("Connection test failed");
    p.log.warn(
      `Could not verify Gmail access: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
    p.log.warn("The credentials were saved — you can test later with: freeturtle status");
  }

  // Save to .env
  const envPath = join(dir, ".env");
  let envContent = "";
  try {
    envContent = await readFile(envPath, "utf-8");
  } catch {
    // No existing .env
  }

  const envVars: Record<string, string> = {
    GOOGLE_CLIENT_ID: clientId.trim(),
    GOOGLE_CLIENT_SECRET: clientSecret.trim(),
    GOOGLE_GMAIL_REFRESH_TOKEN: refreshToken,
  };

  for (const [key, value] of Object.entries(envVars)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent +=
        `${envContent.endsWith("\n") || envContent === "" ? "" : "\n"}${key}=${value}\n`;
    }
  }

  await mkdir(dirname(envPath), { recursive: true });
  await writeFile(envPath, envContent, "utf-8");
  await chmod(envPath, 0o600);

  p.log.success("Gmail credentials saved to .env");

  await enableModule(dir, "gmail");

  try {
    const { rpcCall } = await import("../rpc/client.js");
    await rpcCall("reload");
    p.log.success("Daemon reloaded — Gmail is now active.");
  } catch {
    p.log.info("Run 'freeturtle reload' or restart the daemon to activate Gmail.");
  }

  p.outro("Gmail connected!");

  return {
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
    email: email.trim(),
  };
}
