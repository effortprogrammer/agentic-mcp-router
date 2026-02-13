#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type JsonObject = Record<string, unknown>;

const DEFAULT_ROUTER_COMMAND = ["python3", "-m", "mcp_tool_router.router_mcp_server"];

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

  if (args[0] === "opencode" && args[1] === "install") {
    opencodeInstall(args.slice(2));
    return;
  }

  console.error(`Unknown command: ${args.join(" ")}`);
  printHelp();
  process.exit(1);
}

function opencodeInstall(args: string[]): void {
  const options = parseInstallArgs(args);
  const configPath = expandHome(
    options.config || process.env.OPENCODE_CONFIG || "~/.config/opencode/opencode.json",
  );
  const payload = loadConfig(configPath);
  const mcp = ensureMcp(payload);

  const routerCommand = options.routerCommand.length > 0 ? options.routerCommand : DEFAULT_ROUTER_COMMAND;
  const routerId = options.routerId;

  const existing = mcp[routerId];
  const routerEntry =
    typeof existing === "object" && existing !== null ? { ...(existing as JsonObject) } : {};
  routerEntry.type = "local";
  routerEntry.enabled = true;
  routerEntry.command = routerCommand;
  mcp[routerId] = routerEntry;

  if (options.disableOthers) {
    for (const [serverId, entry] of Object.entries(mcp)) {
      if (serverId === routerId) {
        continue;
      }
      if (typeof entry === "object" && entry !== null) {
        (entry as JsonObject).enabled = false;
      }
    }
  }

  if (options.dryRun) {
    printJson(payload);
    return;
  }

  writeConfig(configPath, payload, options.createBackup);
  console.log(`Updated OpenCode config at ${configPath}`);
}

function parseInstallArgs(args: string[]): {
  config: string | null;
  routerId: string;
  routerCommand: string[];
  disableOthers: boolean;
  createBackup: boolean;
  dryRun: boolean;
} {
  let config: string | null = null;
  let routerId = "router";
  let disableOthers = true;
  let createBackup = true;
  let dryRun = false;
  let routerCommand: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--config" && args[i + 1]) {
      config = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--router-id" && args[i + 1]) {
      routerId = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--router-command") {
      const result = readCommandArgs(args, i + 1);
      routerCommand = result.command;
      i = result.nextIndex;
      continue;
    }
    if (arg === "--keep-others") {
      disableOthers = false;
      continue;
    }
    if (arg === "--disable-others") {
      disableOthers = true;
      continue;
    }
    if (arg === "--no-backup") {
      createBackup = false;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("--")) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  return { config, routerId, routerCommand, disableOthers, createBackup, dryRun };
}

function readCommandArgs(args: string[], startIndex: number): { command: string[]; nextIndex: number } {
  const command: string[] = [];
  let i = startIndex;
  for (; i < args.length; i += 1) {
    if (args[i].startsWith("--")) {
      i -= 1;
      break;
    }
    command.push(args[i]);
  }
  if (command.length === 1 && command[0].includes(" ")) {
    command.splice(0, 1, ...command[0].split(" ").filter(Boolean));
  }
  return { command, nextIndex: i };
}

function loadConfig(configPath: string): JsonObject {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const payload = JSON.parse(raw);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("OpenCode config must be a JSON object.");
  }
  return payload as JsonObject;
}

function ensureMcp(payload: JsonObject): Record<string, JsonObject> {
  if (!("mcp" in payload) || payload.mcp == null) {
    payload.mcp = {};
  }
  if (typeof payload.mcp !== "object" || payload.mcp === null || Array.isArray(payload.mcp)) {
    throw new Error("OpenCode config 'mcp' field must be an object.");
  }
  return payload.mcp as Record<string, JsonObject>;
}

function writeConfig(configPath: string, payload: JsonObject, createBackup: boolean): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  if (createBackup && fs.existsSync(configPath)) {
    fs.copyFileSync(configPath, `${configPath}.bak`);
  }
  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2));
}

function expandHome(value: string): string {
  if (value.startsWith("~")) {
    return path.join(os.homedir(), value.slice(1));
  }
  return value;
}

function printJson(payload: JsonObject): void {
  console.log(JSON.stringify(payload, null, 2));
}

function printHelp(): void {
  console.log(
    [
      "tool-router opencode install [options]",
      "",
      "Options:",
      "  --config <path>           OpenCode config path (default: ~/.config/opencode/opencode.json)",
      "  --router-id <id>          MCP server id for the router (default: router)",
      "  --router-command <cmd..>  Router command (default: python3 -m mcp_tool_router.router_mcp_server)",
      "  --keep-others             Keep existing enabled flags for other MCP entries",
      "  --disable-others          Disable all other MCP entries (default)",
      "  --no-backup               Do not create a .bak backup",
      "  --dry-run                 Print changes without writing",
    ].join("\n"),
  );
}

main();
