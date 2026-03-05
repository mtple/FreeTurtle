import * as p from "@clack/prompts";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ViemLocalEip712Signer } from "@farcaster/hub-nodejs";
import { bytesToHex, hexToBytes } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import qrcode from "qrcode-terminal";

const NEYNAR_BASE = "https://api.neynar.com/v2/farcaster";

interface SignerResponse {
  signer_uuid: string;
  public_key: string;
  status: string;
  signer_approval_url?: string;
  fid?: number;
}

async function neynarPost(
  path: string,
  apiKey: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`${NEYNAR_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Neynar API error (${res.status}): ${text}`);
  }
  return res.json();
}

async function neynarGet(
  path: string,
  apiKey: string
): Promise<unknown> {
  const res = await fetch(`${NEYNAR_BASE}${path}`, {
    headers: { "x-api-key": apiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Neynar API error (${res.status}): ${text}`);
  }
  return res.json();
}

async function lookupFidByCustodyAddress(
  apiKey: string,
  address: string
): Promise<number> {
  const data = (await neynarGet(
    `/user/custody-address?custody_address=${address}`,
    apiKey
  )) as { user: { fid: number } };
  return data.user.fid;
}

async function pollSignerStatus(
  apiKey: string,
  signerUuid: string,
  maxWaitMs = 180_000
): Promise<SignerResponse> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const data = (await neynarGet(
      `/signer?signer_uuid=${signerUuid}`,
      apiKey
    )) as SignerResponse;
    if (data.status === "approved") return data;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Timed out waiting for approval");
}

export async function connectFarcaster(dir: string): Promise<{
  neynarKey: string;
  signerUuid: string;
  fid: string;
} | null> {
  p.intro("Connect Farcaster");

  // Load existing .env values
  const envPath = join(dir, ".env");
  const existingEnv: Record<string, string> = {};
  try {
    const content = await readFile(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match) existingEnv[match[1]] = match[2];
    }
  } catch {
    // No existing .env
  }

  p.note(
    [
      "You'll need:",
      "",
      "  1. Your Neynar API key (sign up at dev.neynar.com)",
      "  2. The recovery phrase for the Farcaster account",
      "     you want to post from",
      "     Farcaster app → Settings → Advanced → Recovery phrase",
      "",
      "The recovery phrase is used locally to authorize the signer.",
      "It is never sent to any server.",
      "",
      "After setup, a QR code will appear in your terminal.",
      "Scan it with the Farcaster app to approve.",
    ].join("\n"),
    "What you'll need"
  );

  let apiKey: string;
  if (existingEnv.NEYNAR_API_KEY) {
    const reuse = await p.confirm({
      message: `Use existing Neynar API key? (${existingEnv.NEYNAR_API_KEY.slice(0, 8)}...)`,
      initialValue: true,
    });
    if (p.isCancel(reuse)) { p.cancel("Cancelled."); return null; }
    if (reuse) {
      apiKey = existingEnv.NEYNAR_API_KEY;
    } else {
      const result = await p.text({
        message: "Neynar API key",
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
      if (p.isCancel(result)) { p.cancel("Cancelled."); return null; }
      apiKey = result;
    }
  } else {
    const result = await p.text({
      message: "Neynar API key",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    });
    if (p.isCancel(result)) { p.cancel("Cancelled."); return null; }
    apiKey = result;
  }

  const mnemonic = await p.text({
    message: "Farcaster recovery phrase (12 words, space-separated)",
    placeholder: "word1 word2 word3 ... word12",
    validate: (v) => {
      if (!v?.trim()) return "Required";
      const words = v.trim().split(/\s+/);
      if (words.length !== 12)
        return `Expected 12 words, got ${words.length}`;
      return undefined;
    },
  });
  if (p.isCancel(mnemonic)) { p.cancel("Cancelled."); return null; }

  const s = p.spinner();

  // Step 1: Derive custody address and look up FID
  s.start("Looking up your Farcaster account");
  let fid: number;
  let account: ReturnType<typeof mnemonicToAccount>;
  try {
    account = mnemonicToAccount(mnemonic);
    fid = await lookupFidByCustodyAddress(apiKey, account.address);
  } catch (err) {
    s.stop("Failed");
    const msg = err instanceof Error ? err.message : "Unknown error";
    p.log.error(`Could not find Farcaster account: ${msg}`);
    return null;
  }
  s.stop(`Found account (FID: ${fid})`);

  // Step 2: Create signer
  s.start("Creating signer");
  let signer: SignerResponse;
  try {
    signer = (await neynarPost("/signer", apiKey)) as SignerResponse;
  } catch (err) {
    s.stop("Failed");
    const msg = err instanceof Error ? err.message : "Unknown error";
    p.log.error(`Could not create signer: ${msg}`);
    return null;
  }
  s.stop("Signer created");

  // Step 3: Sign the key request locally
  s.start("Authorizing signer");
  let sigHex: string;
  let deadline: number;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const appAccountKey = new ViemLocalEip712Signer(account as any);
    deadline = Math.floor(Date.now() / 1000) + 86400;
    const keyBytes = hexToBytes(signer.public_key as `0x${string}`);

    const signature = await appAccountKey.signKeyRequest({
      requestFid: BigInt(fid),
      key: keyBytes,
      deadline: BigInt(deadline),
    });

    if (signature.isErr()) {
      throw new Error("Signature generation failed");
    }
    sigHex = bytesToHex(signature.value);
  } catch (err) {
    s.stop("Failed");
    const msg = err instanceof Error ? err.message : "Unknown error";
    p.log.error(`Could not authorize signer: ${msg}`);
    return null;
  }
  s.stop("Signer authorized");

  // Step 4: Register signed key to get approval URL
  s.start("Registering with Neynar");
  let registeredSigner: SignerResponse;
  try {
    registeredSigner = (await neynarPost("/signer/signed_key", apiKey, {
      signer_uuid: signer.signer_uuid,
      app_fid: fid,
      deadline,
      signature: sigHex,
    })) as SignerResponse;
  } catch (err) {
    s.stop("Failed");
    const msg = err instanceof Error ? err.message : "Unknown error";
    p.log.error(`Could not register signer: ${msg}`);
    return null;
  }
  s.stop("Registered");

  if (!registeredSigner.signer_approval_url) {
    p.log.error("No approval URL returned from Neynar.");
    return null;
  }

  // Step 5: Show QR code
  p.log.info("Scan this QR code with the Farcaster app to approve:\n");
  await new Promise<void>((resolve) => {
    qrcode.generate(registeredSigner.signer_approval_url!, { small: true }, (code) => {
      console.log(code);
      resolve();
    });
  });
  console.log(`\n  Or open: ${registeredSigner.signer_approval_url}\n`);

  // Step 6: Poll for approval
  s.start("Waiting for approval (scan the QR code above)");
  let approved: SignerResponse;
  try {
    approved = await pollSignerApproval(apiKey, signer.signer_uuid);
  } catch {
    s.stop("Timed out");
    p.log.warn("Signer not yet approved. You can re-run this command to try again.");
    return null;
  }
  s.stop("Signer approved!");

  const approvedFid = String(approved.fid ?? fid);

  // Step 7: Save to .env
  let envContent = "";
  try {
    envContent = await readFile(envPath, "utf-8");
  } catch {
    // No existing .env
  }

  const envVars: Record<string, string> = {
    NEYNAR_API_KEY: apiKey,
    FARCASTER_SIGNER_UUID: signer.signer_uuid,
    FARCASTER_FID: approvedFid,
  };

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
  p.log.success("Credentials saved to .env");

  p.outro("Farcaster connected!");

  return {
    neynarKey: apiKey,
    signerUuid: signer.signer_uuid,
    fid: approvedFid,
  };
}

async function pollSignerApproval(
  apiKey: string,
  signerUuid: string,
  maxWaitMs = 180_000
): Promise<SignerResponse> {
  return pollSignerStatus(apiKey, signerUuid, maxWaitMs);
}
