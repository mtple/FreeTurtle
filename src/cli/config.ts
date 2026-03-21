import * as p from "@clack/prompts";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { PROVIDERS, PROVIDER_ORDER, updateConfigLlm, mergeEnv } from "../setup.js";
import type { LLMProvider } from "../llm.js";

/**
 * `freeturtle config` — show current config
 */
export async function runConfigShow(dir: string): Promise<void> {
  const config = await loadConfig(dir);
  const info = PROVIDERS[config.llm.provider as LLMProvider];

  console.log(`\n  \x1b[38;2;94;255;164m🐢 FreeTurtle Config\x1b[0m\n`);
  console.log(`  Provider   ${info?.label ?? config.llm.provider}`);
  console.log(`  Model      ${config.llm.model}`);
  console.log(`  Max tokens ${config.llm.max_tokens}`);
  if (config.llm.base_url) {
    console.log(`  Base URL   ${config.llm.base_url}`);
  }

  console.log(`\n  Heartbeat  ${config.heartbeat.enabled ? `every ${config.heartbeat.interval_minutes}m` : "off"}`);

  const cronNames = Object.keys(config.cron);
  console.log(`  Cron tasks ${cronNames.length > 0 ? cronNames.join(", ") : "none"}`);

  const enabledChannels = Object.entries(config.channels)
    .filter(([, c]) => c.enabled)
    .map(([name]) => name);
  console.log(`  Channels   ${enabledChannels.join(", ") || "none"}`);

  const enabledModules = Object.entries(config.modules)
    .filter(([, m]) => m.enabled)
    .map(([name]) => name);
  console.log(`  Modules    ${enabledModules.join(", ") || "none"}`);
  console.log();
}

/**
 * `freeturtle config llm` — change provider (full setup: provider + creds + model)
 */
export async function runConfigLlm(dir: string): Promise<void> {
  const config = await loadConfig(dir);
  const currentProvider = config.llm.provider as LLMProvider;

  const providerKey = (await p.select({
    message: "LLM provider",
    options: PROVIDER_ORDER.map((key) => ({
      value: key,
      label: PROVIDERS[key].label,
      hint: key === currentProvider ? "(current)" : PROVIDERS[key].hint,
    })),
    initialValue: currentProvider,
  })) as LLMProvider;

  if (p.isCancel(providerKey)) return;

  const info = PROVIDERS[providerKey];

  // Check if switching providers — need new credentials
  let credentialValue: string | undefined;
  if (providerKey !== currentProvider) {
    const envPath = join(dir, ".env");
    let existing = "";
    try { existing = await readFile(envPath, "utf-8"); } catch { /* */ }
    const existingEnv = parseEnvSimple(existing);
    const existingCred = existingEnv[info.credEnv];

    if (existingCred) {
      const useExisting = await p.confirm({
        message: `Found existing ${info.credEnv} in .env (••••${existingCred.slice(-6)}). Use it?`,
        initialValue: true,
      });
      if (p.isCancel(useExisting)) return;
      if (!useExisting) {
        const cred = await p.text({
          message: info.credPrompt,
          validate: (v) => (v?.trim() ? undefined : "Required"),
        });
        if (p.isCancel(cred)) return;
        credentialValue = cred.trim();
      }
    } else {
      const cred = await p.text({
        message: info.credPrompt,
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
      if (p.isCancel(cred)) return;
      credentialValue = cred.trim();
    }
  }

  // Model selection
  const model = (await p.text({
    message: "Model",
    placeholder: info.defaultModel,
    defaultValue: providerKey === currentProvider ? config.llm.model : undefined,
  })) as string;

  if (p.isCancel(model)) return;
  const finalModel = model.trim() || info.defaultModel;

  // Write changes
  const configPath = join(dir, "config.md");
  let configContent = await readFile(configPath, "utf-8");
  configContent = updateConfigLlm(configContent, {
    provider: providerKey,
    model: finalModel,
    [info.credEnvField]: info.credEnv,
  });
  await writeFile(configPath, configContent, "utf-8");

  if (credentialValue) {
    const envPath = join(dir, ".env");
    let existing = "";
    try { existing = await readFile(envPath, "utf-8"); } catch { /* */ }
    await writeFile(envPath, mergeEnv(existing, { [info.credEnv]: credentialValue }), "utf-8");
    await chmod(envPath, 0o600);
  }

  p.log.success(`LLM updated: ${info.label} / ${finalModel}`);

  // Auto-reload if daemon is running
  await tryReload();
}

/**
 * `freeturtle config model <name>` — quick model switch (no interactive prompts)
 */
export async function runConfigModel(dir: string, modelName?: string): Promise<void> {
  const config = await loadConfig(dir);
  const currentProvider = config.llm.provider as LLMProvider;
  const info = PROVIDERS[currentProvider];

  let finalModel: string;
  if (modelName) {
    finalModel = modelName;
  } else {
    const model = (await p.text({
      message: `Model (${info?.label ?? currentProvider})`,
      placeholder: config.llm.model,
      defaultValue: config.llm.model,
    })) as string;
    if (p.isCancel(model)) return;
    finalModel = model.trim() || config.llm.model;
  }

  if (finalModel === config.llm.model) {
    console.log(`  Already using ${finalModel}`);
    return;
  }

  const configPath = join(dir, "config.md");
  let configContent = await readFile(configPath, "utf-8");
  configContent = updateConfigLlm(configContent, { model: finalModel });
  await writeFile(configPath, configContent, "utf-8");

  p.log.success(`Model switched: ${finalModel}`);
  await tryReload();
}

async function tryReload(): Promise<void> {
  try {
    const { rpcCall } = await import("../rpc/client.js");
    const result = await rpcCall("reload") as { reloaded: string[] };
    if (result.reloaded.includes("llm")) {
      p.log.info("Daemon reloaded with new LLM config.");
    } else {
      p.log.info("Daemon config reloaded.");
    }
  } catch {
    p.log.info("Daemon not running — changes will take effect on next start.");
  }
}

function parseEnvSimple(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}
