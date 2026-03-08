import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { execSync } from "node:child_process";

const SERVICE_NAME = "freeturtle";

/* ── systemd (Linux) ────────────────────────────────────────────────── */

function getSystemdUnit(dir: string): string {
  const nodePath = execSync("which node", { encoding: "utf-8" }).trim();
  const freeturtleBin = resolve(join(import.meta.dirname, "../../bin/freeturtle.js"));

  return `[Unit]
Description=FreeTurtle AI CEO
After=network.target

[Service]
ExecStart=${nodePath} ${freeturtleBin} start --dir ${dir}
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

async function installSystemd(dir: string): Promise<void> {
  const serviceDir = join(homedir(), ".config", "systemd", "user");
  const servicePath = join(serviceDir, `${SERVICE_NAME}.service`);

  await mkdir(serviceDir, { recursive: true });
  await writeFile(servicePath, getSystemdUnit(dir), "utf-8");

  console.log(`Service file written to ${servicePath}`);
  console.log();

  execSync("systemctl --user daemon-reload", { stdio: "inherit" });
  execSync(`systemctl --user enable ${SERVICE_NAME}`, { stdio: "inherit" });
  execSync(`systemctl --user start ${SERVICE_NAME}`, { stdio: "inherit" });

  console.log();
  console.log("FreeTurtle service installed and started.");
  console.log();
  console.log("Manage with:");
  console.log(`  systemctl --user status ${SERVICE_NAME}`);
  console.log(`  systemctl --user stop ${SERVICE_NAME}`);
  console.log(`  systemctl --user restart ${SERVICE_NAME}`);
  console.log(`  journalctl --user -u ${SERVICE_NAME} -f`);
  console.log();
  console.log("To ensure the service survives logouts:");
  console.log("  sudo loginctl enable-linger $(whoami)");
}

/* ── launchd (macOS) ────────────────────────────────────────────────── */

function getLaunchdPlist(dir: string): string {
  const nodePath = execSync("which node", { encoding: "utf-8" }).trim();
  const freeturtleBin = resolve(join(import.meta.dirname, "../../bin/freeturtle.js"));
  const logDir = join(homedir(), "Library", "Logs", SERVICE_NAME);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.freeturtle.daemon</string>

  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${freeturtleBin}</string>
    <string>start</string>
    <string>--dir</string>
    <string>${dir}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>${logDir}/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/stderr.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
`;
}

async function installLaunchd(dir: string): Promise<void> {
  const agentDir = join(homedir(), "Library", "LaunchAgents");
  const plistPath = join(agentDir, "com.freeturtle.daemon.plist");
  const logDir = join(homedir(), "Library", "Logs", SERVICE_NAME);

  await mkdir(agentDir, { recursive: true });
  await mkdir(logDir, { recursive: true });

  // Unload existing service if present (ignore errors if not loaded)
  try {
    execSync(`launchctl bootout gui/$(id -u) ${plistPath} 2>/dev/null`, { stdio: "ignore" });
  } catch {
    // not loaded — that's fine
  }

  await writeFile(plistPath, getLaunchdPlist(dir), "utf-8");

  console.log(`LaunchAgent written to ${plistPath}`);
  console.log();

  execSync(`launchctl bootstrap gui/$(id -u) ${plistPath}`, { stdio: "inherit" });

  console.log();
  console.log("FreeTurtle service installed and started.");
  console.log();
  console.log("Manage with:");
  console.log(`  launchctl kickstart -k gui/$(id -u)/com.freeturtle.daemon   # restart`);
  console.log(`  launchctl bootout gui/$(id -u)/com.freeturtle.daemon        # stop`);
  console.log(`  tail -f ~/Library/Logs/${SERVICE_NAME}/stdout.log           # logs`);
}

/* ── Public API ─────────────────────────────────────────────────────── */

export async function runInstallService(dir: string): Promise<void> {
  const os = platform();

  try {
    if (os === "darwin") {
      await installLaunchd(dir);
    } else {
      await installSystemd(dir);
    }
  } catch {
    console.log();
    if (os === "darwin") {
      console.log("Service file written but could not start automatically.");
      console.log();
      console.log("Try manually:");
      console.log(`  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.freeturtle.daemon.plist`);
    } else {
      console.log("Service file written but could not start automatically.");
      console.log();
      console.log("On a Linux server, run:");
      console.log(`  systemctl --user daemon-reload`);
      console.log(`  systemctl --user enable --now ${SERVICE_NAME}`);
      console.log();
      console.log("To ensure the service survives logouts:");
      console.log("  sudo loginctl enable-linger $(whoami)");
    }
  }
}
