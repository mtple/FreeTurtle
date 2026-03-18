import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type PolicyConfig, parsePolicy } from "./policy.js";
import type { SkillsConfig } from "./skills/types.js";

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

export interface HeartbeatConfig {
  enabled: boolean;
  interval_minutes: number;
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
  heartbeat: HeartbeatConfig;
  cron: Record<string, CronTask>;
  channels: Record<string, ChannelConfig>;
  modules: Record<string, ModuleConfig>;
  skills: SkillsConfig;
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
    llm: { provider: "claude_api", model: "claude-sonnet-4-5", max_tokens: 4096 },
    heartbeat: { enabled: true, interval_minutes: 30 },
    cron: {},
    channels: {},
    modules: {},
    skills: { enabled: true },
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
    } else if (currentSection === "heartbeat") {
      if (key === "enabled") {
        config.heartbeat.enabled = value === "true";
      } else if (key === "interval_minutes") {
        config.heartbeat.interval_minutes = parseInt(value, 10);
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
    } else if (currentSection === "skills") {
      if (key === "enabled") {
        config.skills.enabled = value === "true";
      } else if (key === "extra_dirs") {
        config.skills.extra_dirs = value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      }
    } else if (currentSection === "policy" && currentSubSection) {
      if (!policyRaw[currentSubSection]) {
        policyRaw[currentSubSection] = {};
      }
      policyRaw[currentSubSection][key] = parseValue(value);
    }
  }

  // Filter out disabled cron tasks — "disabled" is not a valid cron expression
  // and will crash Croner if passed through.
  for (const [name, task] of Object.entries(config.cron)) {
    const sched = task.schedule.trim().toLowerCase();
    if (!sched || sched === "disabled" || sched === "none" || sched === "off") {
      delete config.cron[name];
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
