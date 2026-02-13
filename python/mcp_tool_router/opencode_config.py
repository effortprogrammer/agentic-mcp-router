from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

DEFAULT_ROUTER_CMD = ["python3", "-m", "mcp_tool_router.router_mcp_server"]

_WELL_KNOWN_REMOTE_MCPS: dict[str, dict[str, Any]] = {
    "context7": {
        "type": "remote",
        "url": "https://mcp.context7.com/mcp",
        "enabled": False,
    },
    "grep_app": {
        "type": "remote",
        "url": "https://mcp.grep.app",
        "enabled": False,
    },
    "websearch": {
        "type": "remote",
        "url": "https://mcp.exa.ai/mcp?tools=web_search_exa",
        "enabled": False,
    },
}


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
    router_entry = (
        dict(mcp.get(router_id, {})) if isinstance(mcp.get(router_id), dict) else {}
    )
    router_entry.update(
        {
            "type": "local",
            "enabled": True,
            "command": command,
        }
    )
    env_overrides = _resolve_env_overrides()
    if env_overrides:
        environment = (
            dict(router_entry.get("environment", {}))
            if isinstance(router_entry.get("environment"), dict)
            else {}
        )
        environment.update(env_overrides)
        router_entry["environment"] = environment

    mcp[router_id] = router_entry

    for remote_id, remote_entry in _WELL_KNOWN_REMOTE_MCPS.items():
        if remote_id not in mcp:
            mcp[remote_id] = dict(remote_entry)

    if disable_others:
        for server_id, entry in mcp.items():
            if server_id == router_id:
                continue
            if isinstance(entry, dict):
                entry["enabled"] = False

    _write_config(path, payload, create_backup=create_backup)
    _disable_oh_my_opencode_mcps(path.parent, create_backup=create_backup)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Configure OpenCode to use the MCP router."
    )
    parser.add_argument(
        "--config",
        default="~/.config/opencode/opencode.json",
        help="Path to opencode.json",
    )
    parser.add_argument(
        "--router-id", default="router", help="MCP server id for the router entry"
    )
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
    parser.add_argument(
        "--dry-run", action="store_true", help="Print changes without writing"
    )

    args = parser.parse_args()

    payload, path = _load_config(args.config)
    mcp = _ensure_mcp(payload)
    command = list(args.router_command or DEFAULT_ROUTER_CMD)

    router_entry = (
        dict(mcp.get(args.router_id, {}))
        if isinstance(mcp.get(args.router_id), dict)
        else {}
    )
    router_entry.update(
        {
            "type": "local",
            "enabled": True,
            "command": command,
        }
    )
    env_overrides = _resolve_env_overrides()
    if env_overrides:
        environment = (
            dict(router_entry.get("environment", {}))
            if isinstance(router_entry.get("environment"), dict)
            else {}
        )
        environment.update(env_overrides)
        router_entry["environment"] = environment

    mcp[args.router_id] = router_entry

    for remote_id, remote_entry in _WELL_KNOWN_REMOTE_MCPS.items():
        if remote_id not in mcp:
            mcp[remote_id] = dict(remote_entry)

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
    _disable_oh_my_opencode_mcps(path.parent, create_backup=args.create_backup)
    return 0


_OH_MY_OPENCODE_BUILTIN_MCPS = ["context7", "grep_app", "websearch"]


def _disable_oh_my_opencode_mcps(config_dir: Path, *, create_backup: bool) -> None:
    omo_path = config_dir / "oh-my-opencode.json"

    omo_payload: dict[str, Any] = {}
    if omo_path.exists():
        try:
            raw = json.loads(omo_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                omo_payload = raw
        except (json.JSONDecodeError, OSError):
            return

    existing: list[str] = (
        omo_payload.get("disabled_mcps", [])
        if isinstance(omo_payload.get("disabled_mcps"), list)
        else []
    )
    merged = list(dict.fromkeys(existing + _OH_MY_OPENCODE_BUILTIN_MCPS))

    if merged == existing:
        return

    omo_payload["disabled_mcps"] = merged
    if create_backup and omo_path.exists():
        backup = omo_path.with_suffix(omo_path.suffix + ".bak")
        backup.write_text(omo_path.read_text(encoding="utf-8"), encoding="utf-8")
    config_dir.mkdir(parents=True, exist_ok=True)
    omo_path.write_text(json.dumps(omo_payload, indent=2), encoding="utf-8")
    print(
        f"Disabled oh-my-opencode built-in MCPs ({', '.join(_OH_MY_OPENCODE_BUILTIN_MCPS)})"
        " — now routed through the router."
    )


def _resolve_env_overrides() -> dict[str, str]:
    env: dict[str, str] = {}
    monorepo_root = _find_monorepo_root()
    if monorepo_root is None:
        return env

    python_dir = monorepo_root / "python"
    if python_dir.is_dir() and (python_dir / "mcp_tool_router").is_dir():
        if not _is_package_importable():
            env["PYTHONPATH"] = str(python_dir)

    daemon_cli = monorepo_root / "packages" / "daemon" / "dist" / "cli.js"
    if daemon_cli.is_file():
        env["ROUTERD"] = f"node {daemon_cli}"

    return env


def _find_monorepo_root() -> Path | None:
    current = Path(__file__).resolve().parent
    for _ in range(8):
        if (current / "python" / "mcp_tool_router").is_dir() and (
            current / "packages" / "daemon"
        ).is_dir():
            return current
        parent = current.parent
        if parent == current:
            break
        current = parent
    return None


def _is_package_importable() -> bool:
    python = _find_python()
    if python is None:
        return False
    result = subprocess.run(
        [python, "-c", "import mcp_tool_router"],
        capture_output=True,
    )
    return result.returncode == 0


def _find_python() -> str | None:
    for cmd in ("python3", "python"):
        if shutil.which(cmd) is not None:
            return cmd
    return None


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
