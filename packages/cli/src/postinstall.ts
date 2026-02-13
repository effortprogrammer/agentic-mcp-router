#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

const PIP_PACKAGE = "mcp-tool-router";
const PIP_GIT_URL =
  "git+https://github.com/effortprogrammer/agentic-tool-router.git#subdirectory=python";

function main(): void {
  ensurePythonPackage();

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
    [
      path.join("dist", "index.js"),
      "opencode",
      "install",
      "--config",
      configPath,
    ],
    { stdio: "inherit" },
  );
  if (result.status && result.status !== 0) {
    process.exit(result.status);
  }
}

function ensurePythonPackage(): void {
  const python = findPython();
  if (!python) {
    console.warn(
      "[mcp-tool-router] python3 not found. Install Python 3.10+ and run:\n" +
        `  pip install ${PIP_PACKAGE}`,
    );
    return;
  }

  if (isPackageImportable(python)) {
    return;
  }

  console.log("[mcp-tool-router] Installing Python package...");

  if (tryPipInstall(python, [PIP_PACKAGE])) {
    return;
  }

  if (tryPipInstall(python, [PIP_GIT_URL])) {
    return;
  }

  console.warn(
    "[mcp-tool-router] Could not auto-install the Python package. Install manually:\n" +
      `  pip install ${PIP_PACKAGE}\n` +
      "  # or\n" +
      `  pip install "${PIP_GIT_URL}"`,
  );
}

function findPython(): string | null {
  for (const cmd of ["python3", "python"]) {
    const r = spawnSync(cmd, ["--version"], { stdio: "pipe" });
    if (r.status === 0) {
      return cmd;
    }
  }
  return null;
}

function isPackageImportable(python: string): boolean {
  const r = spawnSync(python, ["-c", "import mcp_tool_router"], {
    stdio: "pipe",
  });
  return r.status === 0;
}

function tryPipInstall(python: string, args: string[]): boolean {
  const strategies: [string, string[]][] = [
    [python, ["-m", "pip", "install", ...args]],
    ["uv", ["pip", "install", ...args]],
  ];
  for (const [cmd, rest] of strategies) {
    const r = spawnSync(cmd, rest, { stdio: "pipe" });
    if (r.status === 0) {
      console.log(`[mcp-tool-router] Python package installed via ${cmd}.`);
      return true;
    }
  }
  return false;
}

function resolveConfigPath(): string {
  if (process.env.OPENCODE_CONFIG) {
    return process.env.OPENCODE_CONFIG;
  }
  const base =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "opencode/opencode.json");
}

main();
