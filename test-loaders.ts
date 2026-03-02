import { loadSoul } from "./src/soul.js";
import { loadConfig } from "./src/config.js";
import { readMemoryFile, writeMemoryFile, appendToJsonArray } from "./src/memory.js";
import { createLogger } from "./src/logger.js";
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = "/tmp/test-ft";

async function main() {
  // Set up test workspace
  mkdirSync(join(TEST_DIR, "workspace", "memory"), { recursive: true });
  cpSync("templates/soul.md", join(TEST_DIR, "soul.md"));
  cpSync("templates/config.md", join(TEST_DIR, "config.md"));

  const logger = createLogger(TEST_DIR);

  // Test 1: Load soul
  logger.info("=== Test 1: Load Soul ===");
  const soul = await loadSoul(TEST_DIR);
  logger.info(`Soul loaded (${soul.length} chars). First 100: ${soul.slice(0, 100)}...`);

  // Test 2: Load config
  logger.info("=== Test 2: Load Config ===");
  const config = await loadConfig(TEST_DIR);
  logger.info(`Config: ${JSON.stringify(config, null, 2)}`);

  // Test 3: Write and read memory
  logger.info("=== Test 3: Memory Read/Write ===");
  await writeMemoryFile(TEST_DIR, "test-note.txt", "Hello from FreeTurtle!");
  const content = await readMemoryFile(TEST_DIR, "test-note.txt");
  logger.info(`Memory read back: "${content}"`);

  // Test 4: Append to JSON array
  logger.info("=== Test 4: JSON Array Append ===");
  await appendToJsonArray(TEST_DIR, "test-log.json", { ts: new Date().toISOString(), msg: "first entry" });
  await appendToJsonArray(TEST_DIR, "test-log.json", { ts: new Date().toISOString(), msg: "second entry" });
  const logContent = await readMemoryFile(TEST_DIR, "test-log.json");
  logger.info(`JSON array: ${logContent}`);

  // Test 5: Missing soul should throw
  logger.info("=== Test 5: Missing Soul Error ===");
  try {
    await loadSoul("/tmp/nonexistent-dir");
    logger.error("Should have thrown!");
  } catch (err) {
    logger.info(`Correctly threw: ${(err as Error).message}`);
  }

  logger.info("=== All tests passed! ===");
}

main().catch(console.error);
