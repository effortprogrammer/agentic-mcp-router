from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

DEFAULT_ROUTER_CMD = ["python3", "-m", "mcp_tool_router.router_mcp_server"]


def apply_router_config(
  config_path: str,
  router_id: str = "router",
  router_command: list[str] | None = None,
  disable_others: bool = True,
  create_backup: bool = True,
) -> dict[str, Any]:
  payload, path = _load_config(config_path)
  mcp = _ensure_mcp(payload)

  command = list(router_command or DEFAULT_ROUTER_CMD)
  router_entry = dict(mcp.get(router_id, {})) if isinstance(mcp.get(router_id), dict) else {}
  router_entry.update(
    {
      "type": "local",
      "enabled": True,
      "command": command,
    }
  )
  mcp[router_id] = router_entry

  if disable_others:
    for server_id, entry in mcp.items():
      if server_id == router_id:
        continue
      if isinstance(entry, dict):
        entry["enabled"] = False

  _write_config(path, payload, create_backup=create_backup)
  return payload


def main() -> int:
  parser = argparse.ArgumentParser(description="Configure OpenCode to use the MCP router.")
  parser.add_argument(
    "--config",
    default="~/.config/opencode/opencode.json",
    help="Path to opencode.json",
  )
  parser.add_argument("--router-id", default="router", help="MCP server id for the router entry")
  parser.add_argument(
    "--router-command",
    nargs="+",
    help="Router command (e.g., python3 -m mcp_tool_router.router_mcp_server)",
  )
  parser.add_argument(
    "--disable-others",
    dest="disable_others",
    action="store_true",
    help="Disable all other MCP entries (default)",
  )
  parser.add_argument(
    "--keep-others",
    dest="disable_others",
    action="store_false",
    help="Keep existing enabled flags for other MCP entries",
  )
  parser.set_defaults(disable_others=True)
  parser.add_argument(
    "--no-backup",
    dest="create_backup",
    action="store_false",
    help="Do not create a .bak backup",
  )
  parser.set_defaults(create_backup=True)
  parser.add_argument("--dry-run", action="store_true", help="Print changes without writing")

  args = parser.parse_args()

  payload, path = _load_config(args.config)
  mcp = _ensure_mcp(payload)
  command = list(args.router_command or DEFAULT_ROUTER_CMD)

  router_entry = dict(mcp.get(args.router_id, {})) if isinstance(mcp.get(args.router_id), dict) else {}
  router_entry.update(
    {
      "type": "local",
      "enabled": True,
      "command": command,
    }
  )
  mcp[args.router_id] = router_entry

  if args.disable_others:
    for server_id, entry in mcp.items():
      if server_id == args.router_id:
        continue
      if isinstance(entry, dict):
        entry["enabled"] = False

  if args.dry_run:
    _print_payload(payload)
    return 0

  _write_config(path, payload, create_backup=args.create_backup)
  return 0


def _load_config(config_path: str) -> tuple[dict[str, Any], Path]:
  path = Path(os.path.expanduser(config_path))
  if not path.exists():
    return {}, path
  with path.open("r", encoding="utf-8") as handle:
    payload = json.load(handle)
  if not isinstance(payload, dict):
    raise ValueError("OpenCode config must be a JSON object.")
  return payload, path


def _ensure_mcp(payload: dict[str, Any]) -> dict[str, Any]:
  if "mcp" not in payload or payload["mcp"] is None:
    payload["mcp"] = {}
  if not isinstance(payload["mcp"], dict):
    raise ValueError("OpenCode config 'mcp' field must be an object.")
  return payload["mcp"]


def _write_config(path: Path, payload: dict[str, Any], create_backup: bool) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  if create_backup and path.exists():
    backup = path.with_suffix(path.suffix + ".bak")
    backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
  path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def _print_payload(payload: dict[str, Any]) -> None:
  print(json.dumps(payload, indent=2, sort_keys=True))


if __name__ == "__main__":
  raise SystemExit(main())
