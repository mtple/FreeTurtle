import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface StoredOAuthProfile {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // unix seconds
  account_id?: string;
  updated_at: number; // unix seconds
}

interface AuthProfiles {
  openai_codex?: StoredOAuthProfile;
}

function profilesPath(dir: string): string {
  return join(dir, "auth", "auth-profiles.json");
}

function runtimePath(dir: string): string {
  return join(dir, "auth", "auth.json");
}

export async function loadOpenAICodexProfile(
  dir: string
): Promise<StoredOAuthProfile | null> {
  try {
    const raw = await readFile(profilesPath(dir), "utf-8");
    const parsed = JSON.parse(raw) as AuthProfiles;
    if (parsed.openai_codex?.access_token) return parsed.openai_codex;
  } catch {
    // ignore missing/invalid profiles file
  }

  try {
    const raw = await readFile(runtimePath(dir), "utf-8");
    const parsed = JSON.parse(raw) as { openai_codex?: StoredOAuthProfile };
    if (parsed.openai_codex?.access_token) return parsed.openai_codex;
  } catch {
    // ignore missing/invalid runtime cache
  }

  return null;
}

export async function saveOpenAICodexProfile(
  dir: string,
  profile: Omit<StoredOAuthProfile, "updated_at">
): Promise<void> {
  const authDir = join(dir, "auth");
  await mkdir(authDir, { recursive: true });

  let profiles: AuthProfiles = {};
  try {
    const raw = await readFile(profilesPath(dir), "utf-8");
    profiles = JSON.parse(raw) as AuthProfiles;
  } catch {
    // create new file
  }

  const updated: StoredOAuthProfile = {
    ...profile,
    updated_at: Math.floor(Date.now() / 1000),
  };

  profiles.openai_codex = updated;

  await writeFile(profilesPath(dir), JSON.stringify(profiles, null, 2), "utf-8");
  await writeFile(
    runtimePath(dir),
    JSON.stringify({ openai_codex: updated }, null, 2),
    "utf-8"
  );
}
