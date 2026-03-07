import * as p from "@clack/prompts";
import { readFile, writeFile, chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  channelToUrl,
  type WebhookSubscription,
} from "../webhooks/neynar.js";

export async function runWebhooksSetup(dir: string): Promise<void> {
  p.intro("Webhook Setup");

  // Load existing .env
  const envPath = join(dir, ".env");
  const existingEnv: Record<string, string> = {};
  try {
    const content = await readFile(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match) existingEnv[match[1]] = match[2];
    }
  } catch {
    // No .env
  }

  const apiKey = existingEnv.NEYNAR_API_KEY;
  const fid = existingEnv.FARCASTER_FID;

  if (!apiKey || !fid) {
    p.log.error(
      "Farcaster must be connected first. Run: freeturtle connect farcaster"
    );
    return;
  }

  // Check for existing webhooks
  const s = p.spinner();
  s.start("Checking existing webhooks");
  let existing;
  try {
    existing = await listWebhooks(apiKey);
  } catch (err) {
    s.stop("Failed");
    p.log.error(
      `Could not list webhooks: ${err instanceof Error ? err.message : "Unknown error"}`
    );
    return;
  }
  s.stop(`Found ${existing.length} existing webhook(s)`);

  if (existing.length > 0) {
    p.log.info("Current webhooks:");
    for (const wh of existing) {
      p.log.message(`  ${wh.title || wh.webhook_id} → ${wh.url} (${wh.active ? "active" : "inactive"})`);
    }

    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "new", label: "Create a new webhook" },
        { value: "delete", label: "Delete an existing webhook" },
        { value: "cancel", label: "Cancel" },
      ],
    });
    if (p.isCancel(action) || action === "cancel") {
      p.cancel("Cancelled.");
      return;
    }

    if (action === "delete") {
      const whId = await p.select({
        message: "Which webhook to delete?",
        options: existing.map((wh) => ({
          value: wh.webhook_id,
          label: `${wh.title || wh.webhook_id} → ${wh.url}`,
        })),
      });
      if (p.isCancel(whId)) { p.cancel("Cancelled."); return; }

      s.start("Deleting webhook");
      try {
        await deleteWebhook(apiKey, whId);
        s.stop("Webhook deleted");
      } catch (err) {
        s.stop("Failed");
        p.log.error(
          `Could not delete webhook: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
      return;
    }
  }

  // Create a new webhook
  p.note(
    [
      "Webhooks let your CEO auto-respond to Farcaster events",
      "(mentions, replies, specific users, channels).",
      "",
      "How it works:",
      "  1. You pick what to listen for",
      "  2. FreeTurtle runs a webhook server on your machine",
      "  3. Neynar sends matching events to your server",
      "",
      "You'll need:",
      "  - Your server's public IP address",
      "    Find it: run `curl ifconfig.me` on your server",
      "    Or: Oracle Cloud Console > Compute > Instances > Public IP",
      "",
      "  - Port 3456 open in BOTH firewalls (if on Oracle Cloud):",
      "    1. Oracle Cloud Console: Networking > VCN > Subnet >",
      "       Security List > Add Ingress Rule (TCP port 3456)",
      "    2. On the server: sudo iptables -I INPUT -p tcp --dport 3456 -j ACCEPT",
      "",
      "Your webhook URL will be: http://<YOUR_PUBLIC_IP>:3456/webhook",
      "",
      "Ctrl+C at any prompt to cancel.",
    ].join("\n"),
    "Webhooks"
  );

  // What to listen for
  const ownFid = parseInt(fid, 10);

  const listeners = await p.multiselect({
    message: "What should your CEO listen for?",
    options: [
      { value: "mentions", label: "Mentions", hint: "someone @'s your CEO" },
      { value: "replies", label: "Replies", hint: "someone replies to your CEO's casts" },
      { value: "users", label: "Specific users", hint: "watch casts from certain accounts" },
      { value: "channels", label: "Channels", hint: "watch new casts in Farcaster channels" },
    ],
    initialValues: ["mentions"],
    required: true,
  });
  if (p.isCancel(listeners)) { p.cancel("Cancelled."); return; }

  const subscription: WebhookSubscription = {};
  let watchFidsStr = "";

  if (listeners.includes("mentions")) {
    subscription.mentionedFids = [ownFid];
  }
  if (listeners.includes("replies")) {
    subscription.parentAuthorFids = [ownFid];
  }

  if (listeners.includes("users")) {
    const fidsInput = await p.text({
      message: "FIDs to watch (comma-separated)",
      placeholder: "e.g. 3, 12345, 99999",
      validate: (v) => {
        if (!v?.trim()) return "Required";
        const fids = v.split(",").map((f) => f.trim());
        if (fids.some((f) => isNaN(parseInt(f, 10)))) return "All values must be numbers";
        return undefined;
      },
    });
    if (p.isCancel(fidsInput)) { p.cancel("Cancelled."); return; }
    const watchFids = fidsInput.split(",").map((f) => parseInt(f.trim(), 10));
    subscription.authorFids = watchFids;
    watchFidsStr = watchFids.join(",");
  }

  if (listeners.includes("channels")) {
    const channelsInput = await p.text({
      message: "Channel names to watch (comma-separated, without /)",
      placeholder: "e.g. farcaster, base, music",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    });
    if (p.isCancel(channelsInput)) { p.cancel("Cancelled."); return; }
    subscription.channelUrls = channelsInput
      .split(",")
      .map((c) => channelToUrl(c.trim()));
  }

  const port = await p.text({
    message: "Webhook server port",
    placeholder: "3456",
    defaultValue: "3456",
    validate: (v) => {
      const n = parseInt(v || "3456", 10);
      if (isNaN(n) || n < 1 || n > 65535) return "Invalid port number";
      return undefined;
    },
  });
  if (p.isCancel(port)) { p.cancel("Cancelled."); return; }

  p.note(
    [
      "Neynar needs a public URL to send events to.",
      "This is your server's public IP + the port you chose + /webhook",
      "",
      "To find your public IP:",
      "  Oracle Cloud Console: Compute > Instances > Public IP Address",
      "  From the server:     curl ifconfig.me",
      "",
      `Example: http://<YOUR_PUBLIC_IP>:${port}/webhook`,
    ].join("\n"),
    "Webhook URL"
  );

  const url = await p.text({
    message: "Your server's public webhook URL",
    placeholder: `http://<YOUR_PUBLIC_IP>:${port}/webhook`,
    validate: (v) => {
      if (!v?.trim()) return "Required";
      if (!v.includes("/webhook")) return "URL should end with /webhook";
      return undefined;
    },
  });
  if (p.isCancel(url)) { p.cancel("Cancelled."); return; }

  const webhookSecret = await p.text({
    message: "Webhook secret (optional, for signature verification)",
    placeholder: "Leave blank to skip",
  });
  if (p.isCancel(webhookSecret)) { p.cancel("Cancelled."); return; }

  // Register with Neynar
  s.start("Registering webhook with Neynar");
  try {
    await createWebhook(
      apiKey,
      `FreeTurtle (FID ${fid})`,
      url,
      subscription,
    );
    s.stop("Webhook registered");
  } catch (err) {
    s.stop("Failed");
    p.log.error(
      `Could not register webhook: ${err instanceof Error ? err.message : "Unknown error"}`
    );
    return;
  }

  // Save to .env
  const envVars: Record<string, string> = {
    WEBHOOK_PORT: port,
    WEBHOOK_ENABLED: "true",
  };
  if (webhookSecret?.trim()) {
    envVars.NEYNAR_WEBHOOK_SECRET = webhookSecret.trim();
  }
  if (watchFidsStr) {
    envVars.WEBHOOK_WATCH_FIDS = watchFidsStr;
  }

  let envContent = "";
  try {
    envContent = await readFile(envPath, "utf-8");
  } catch {
    // No existing .env
  }

  for (const [key, value] of Object.entries(envVars)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `${envContent.endsWith("\n") || envContent === "" ? "" : "\n"}${key}=${value}\n`;
    }
  }

  await mkdir(dirname(envPath), { recursive: true });
  await writeFile(envPath, envContent, "utf-8");
  await chmod(envPath, 0o600);

  p.log.success("Settings saved to .env");

  p.note(
    [
      "Make sure port " + port + " is open in BOTH firewalls (if on Oracle Cloud):",
      "",
      "  1. Oracle Cloud Console: Networking > VCN > Subnet >",
      "     Security List > Add Ingress Rule (TCP port " + port + ")",
      "  2. On the server: sudo iptables -I INPUT -p tcp --dport " + port + " -j ACCEPT",
      "",
      "Then restart FreeTurtle:",
      "",
      "  freeturtle start",
    ].join("\n"),
    "Next steps"
  );

  p.outro("Webhook setup complete!");
}
