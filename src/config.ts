import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type PolicyConfig, parsePolicy } from "./policy.js";

export interface CronTask {
  schedule: string;
  prompt: string;
  output?: string;
  [key: string]: string | undefined;
}

export interface ChannelConfig {
  enabled: boolean;
  [key: string]: string | boolean;
}

export interface ModuleConfig {
  enabled: boolean;
  [key: string]: string | boolean;
}

export interface FreeTurtleConfig {
  llm: {
    provider: string;
    model: string;
    max_tokens: number;
    base_url?: string;
    api_key_env?: string;
    oauth_token_env?: string;
    [key: string]: string | number | undefined;
  };
  cron: Record<string, CronTask>;
  channels: Record<string, ChannelConfig>;
  modules: Record<string, ModuleConfig>;
  policy: PolicyConfig;
}

export async function loadConfig(dir: string): Promise<FreeTurtleConfig> {
  const configPath = join(dir, "config.md");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`config.md not found at ${configPath}. Run 'freeturtle init' to create one.`, { cause: err });
    }
    throw err;
  }
  return parseConfig(raw);
}

function parseConfig(raw: string): FreeTurtleConfig {
  const policyRaw: Record<string, Record<string, string | boolean>> = {};

  const config: FreeTurtleConfig = {
    llm: { provider: "claude_api", model: "claude-sonnet-4-5-20250514", max_tokens: 4096 },
    cron: {},
    channels: {},
    modules: {},
    policy: undefined as unknown as PolicyConfig, // parsed after loop
  };

  let currentSection: string | null = null;
  let currentSubSection: string | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();

    // ## Section header
    const sectionMatch = trimmed.match(/^## (\w+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase();
      currentSubSection = null;
      continue;
    }

    // ### SubSection header
    const subMatch = trimmed.match(/^### (\w+)/);
    if (subMatch) {
      currentSubSection = subMatch[1].toLowerCase();
      continue;
    }

    // - key: value
    const kvMatch = trimmed.match(/^- (\w+):\s*(.+)/);
    if (!kvMatch || !currentSection) continue;

    const key = kvMatch[1];
    const value = kvMatch[2].trim();

    if (currentSection === "llm") {
      if (key === "max_tokens") {
        config.llm.max_tokens = parseInt(value, 10);
      } else {
        (config.llm as Record<string, string | number>)[key] = value;
      }
    } else if (currentSection === "cron" && currentSubSection) {
      if (!config.cron[currentSubSection]) {
        config.cron[currentSubSection] = { schedule: "", prompt: "" };
      }
      (config.cron[currentSubSection] as Record<string, string>)[key] = value;
    } else if (currentSection === "channels" && currentSubSection) {
      if (!config.channels[currentSubSection]) {
        config.channels[currentSubSection] = { enabled: false };
      }
      config.channels[currentSubSection][key] = parseValue(value);
    } else if (currentSection === "modules" && currentSubSection) {
      if (!config.modules[currentSubSection]) {
        config.modules[currentSubSection] = { enabled: false };
      }
      config.modules[currentSubSection][key] = parseValue(value);
    } else if (currentSection === "policy" && currentSubSection) {
      if (!policyRaw[currentSubSection]) {
        policyRaw[currentSubSection] = {};
      }
      policyRaw[currentSubSection][key] = parseValue(value);
    }
  }

  config.policy = parsePolicy(policyRaw);
  return config;
}

function parseValue(value: string): string | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}
