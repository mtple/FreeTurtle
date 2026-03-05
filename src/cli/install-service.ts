import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const SERVICE_NAME = "freeturtle";

function getServiceContent(dir: string): string {
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

export async function runInstallService(dir: string): Promise<void> {
  const serviceDir = join(homedir(), ".config", "systemd", "user");
  const servicePath = join(serviceDir, `${SERVICE_NAME}.service`);

  await mkdir(serviceDir, { recursive: true });

  const content = getServiceContent(dir);
  await writeFile(servicePath, content, "utf-8");

  console.log(`Service file written to ${servicePath}`);
  console.log();

  try {
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
  } catch {
    console.log();
    console.log("Service file written but could not start automatically.");
    console.log("This is normal on macOS — systemd is Linux-only.");
    console.log();
    console.log("On a Linux server, run:");
    console.log(`  systemctl --user daemon-reload`);
    console.log(`  systemctl --user enable --now ${SERVICE_NAME}`);
    console.log();
    console.log("To ensure the service survives logouts:");
    console.log("  sudo loginctl enable-linger $(whoami)");
  }
}
