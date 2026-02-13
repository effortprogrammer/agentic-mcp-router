#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function main(): void {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    console.warn(
      `[mcp-tool-router] OpenCode config not found at ${configPath}. ` +
        "Install OpenCode first or set OPENCODE_CONFIG to the correct path.",
    );
    return;
  }

  const result = spawnSync(
    process.execPath,
    [path.join("dist", "index.js"), "opencode", "install", "--config", configPath],
    { stdio: "inherit" },
  );
  if (result.status && result.status !== 0) {
    process.exit(result.status);
  }
}

function resolveConfigPath(): string {
  if (process.env.OPENCODE_CONFIG) {
    return process.env.OPENCODE_CONFIG;
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "opencode/opencode.json");
}

main();
