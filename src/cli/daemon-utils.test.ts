import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDaemonPid } from "./daemon-utils.js";

describe("getDaemonPid", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ft-daemon-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when no pid file exists", () => {
    const pid = getDaemonPid(dir);
    expect(pid).toBeNull();
  });

  it("returns the pid when the file contains the current process pid", async () => {
    // Write our own PID — it's definitely running
    await writeFile(join(dir, "daemon.pid"), String(process.pid), "utf-8");
    const pid = getDaemonPid(dir);
    expect(pid).toBe(process.pid);
  });

  it("returns null when pid file contains a non-running process", async () => {
    // PID 99999999 is almost certainly not running
    await writeFile(join(dir, "daemon.pid"), "99999999", "utf-8");
    const pid = getDaemonPid(dir);
    expect(pid).toBeNull();
  });

  it("returns null for garbage pid file content", async () => {
    await writeFile(join(dir, "daemon.pid"), "not-a-number", "utf-8");
    const pid = getDaemonPid(dir);
    expect(pid).toBeNull();
  });

  // This test specifically validates that the ESM import works.
  // The bug in v0.1.26-0.1.28 used require("node:fs") which throws in ESM.
  it("uses ESM-compatible fs import (not require)", async () => {
    // If getDaemonPid used require(), this entire test file would fail to
    // import. The fact that we got here means the import is correct.
    // But let's also verify it actually reads the file:
    await writeFile(join(dir, "daemon.pid"), String(process.pid), "utf-8");
    const pid = getDaemonPid(dir);
    expect(pid).toBe(process.pid);
  });
});
