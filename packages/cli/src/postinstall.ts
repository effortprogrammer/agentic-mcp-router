#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const AUTO_ENV = "OPENCODE_AUTO_INSTALL";

function main(): void {
  const flag = (process.env[AUTO_ENV] || "").toLowerCase();
  if (!flag || flag === "0" || flag === "false" || flag === "no") {
    return;
  }

  const configPath = process.env.OPENCODE_CONFIG || path.join(os.homedir(), ".config/opencode/opencode.json");
  const hasConfig = fs.existsSync(configPath);
  if (!hasConfig) {
    return;
  }

  const result = spawnSync(
    process.execPath,
    [path.join("dist", "index.js"), "opencode", "install"],
    { stdio: "inherit" },
  );
  if (result.status && result.status !== 0) {
    process.exit(result.status);
  }
}

main();
