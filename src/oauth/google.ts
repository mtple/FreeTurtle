import { OAuth2Client } from "google-auth-library";
import http from "node:http";
import { createInterface } from "node:readline";
import { execFile } from "node:child_process";

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * Create an authenticated OAuth2Client with auto-refresh.
 */
export function createGoogleOAuth2Client(creds: GoogleOAuthCredentials): OAuth2Client {
  const client = new OAuth2Client(creds.clientId, creds.clientSecret);
  client.setCredentials({ refresh_token: creds.refreshToken });
  return client;
}

/**
 * Open a URL in the user's default browser.
 */
function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(cmd, [url], () => {
    // If browser open fails, the URL is already printed to console
  });
}

/**
 * Prompt the user to paste a URL from their browser (for remote/headless servers).
 */
function waitForPastedUrl(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Paste the callback URL here: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Run the browser-based OAuth2 consent flow.
 *
 * Works both locally and on remote servers:
 * - Locally: starts a localhost HTTP server, opens browser, waits for callback
 * - Remote: prints the auth URL, user approves in browser, pastes the callback URL back
 */
export async function runGoogleOAuthFlow(
  clientId: string,
  clientSecret: string,
  opts?: { port?: number },
): Promise<string> {
  const port = opts?.port ?? 0; // 0 = OS picks a free port

  return new Promise<string>((resolve, reject) => {
    const server = http.createServer();

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OAuth flow timed out after 5 minutes"));
    }, 5 * 60 * 1000);

    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        clearTimeout(timeout);
        server.close();
        reject(new Error("Failed to start local OAuth server"));
        return;
      }

      const redirectUri = `http://127.0.0.1:${addr.port}/callback`;
      const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: ["https://mail.google.com/"],
        prompt: "consent",
      });

      console.log(`\nOpen this URL in your browser to authorize:\n\n  ${authUrl}\n`);
      console.log("After approving, you'll be redirected to a localhost URL.");
      console.log("If the redirect works automatically, great! Otherwise,");
      console.log("copy the FULL URL from your browser's address bar and paste it below.\n");
      openBrowser(authUrl);

      // Race: either the localhost server receives the callback,
      // or the user pastes the URL manually (for remote servers).
      let settled = false;

      const handleCode = async (code: string) => {
        if (settled) return;
        settled = true;
        try {
          const { tokens } = await oauth2Client.getToken(code);
          if (!tokens.refresh_token) {
            clearTimeout(timeout);
            server.close();
            reject(
              new Error(
                "No refresh_token received. Revoke app access at myaccount.google.com/permissions and retry.",
              ),
            );
            return;
          }
          clearTimeout(timeout);
          server.close();
          resolve(tokens.refresh_token);
        } catch (err) {
          clearTimeout(timeout);
          server.close();
          reject(err);
        }
      };

      // Path 1: localhost callback server
      server.on("request", async (req, res) => {
        if (!req.url?.startsWith("/callback")) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const url = new URL(req.url, `http://127.0.0.1:${addr.port}`);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h1>Authorization denied</h1><p>You can close this tab.</p>");
          settled = true;
          clearTimeout(timeout);
          server.close();
          reject(new Error(`OAuth authorization denied: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Missing authorization code</h1>");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Authorization successful!</h1><p>You can close this tab and return to the terminal.</p>",
        );
        await handleCode(code);
      });

      // Path 2: user pastes the URL manually (remote server flow)
      waitForPastedUrl().then(async (pastedUrl) => {
        if (settled) return;
        try {
          const url = new URL(pastedUrl);
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            settled = true;
            clearTimeout(timeout);
            server.close();
            reject(new Error(`OAuth authorization denied: ${error}`));
            return;
          }

          if (!code) {
            settled = true;
            clearTimeout(timeout);
            server.close();
            reject(new Error("No authorization code found in the pasted URL."));
            return;
          }

          await handleCode(code);
        } catch {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            server.close();
            reject(new Error("Invalid URL pasted. Please try again with `freeturtle connect gmail`."));
          }
        }
      }).catch(() => {
        // stdin closed or readline error — ignore, server path may still work
      });
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
