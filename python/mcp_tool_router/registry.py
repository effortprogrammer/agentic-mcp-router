from __future__ import annotations

from dataclasses import dataclass, field
import os
from typing import Any, Iterable

import yaml


@dataclass
class ServerSpec:
  id: str
  cmd: str
  enabled: bool = True
  init: dict | None = None
  send_initialized: bool = False
  tags: list[str] = field(default_factory=list)
  metadata: dict[str, Any] = field(default_factory=dict)
  transport: str = "stdio"


class ServerRegistry:
  def __init__(self, servers: Iterable[ServerSpec]) -> None:
    self._servers = {server.id: server for server in servers}

  @classmethod
  def from_yaml(cls, path: str) -> "ServerRegistry":
    with open(path, "r", encoding="utf-8") as handle:
      payload = yaml.safe_load(handle)
    servers = _parse_registry_payload(payload)
    return cls(servers)

  def list(self) -> list[ServerSpec]:
    return list(self._servers.values())

  def enabled(self) -> list[ServerSpec]:
    return [server for server in self._servers.values() if server.enabled]

  def get(self, server_id: str) -> ServerSpec | None:
    return self._servers.get(server_id)


def _parse_registry_payload(payload: Any) -> list[ServerSpec]:
  if payload is None:
    return []
  if isinstance(payload, dict):
    servers_payload = payload.get("servers")
    if servers_payload is None:
      raise ValueError("Registry YAML must contain a top-level 'servers' list.")
  else:
    servers_payload = payload

  if not isinstance(servers_payload, list):
    raise ValueError("Registry 'servers' must be a list.")

  servers: list[ServerSpec] = []
  for entry in servers_payload:
    if not isinstance(entry, dict):
      raise ValueError("Each server entry must be a mapping.")
    server_id = _string_value(entry, ["id", "serverId", "server_id"])
    cmd = _string_value(entry, ["cmd", "command"])
    if not server_id or not cmd:
      raise ValueError("Each server entry requires 'id' and 'cmd'.")
    transport = str(entry.get("transport") or "stdio")
    if transport != "stdio":
      raise ValueError(f"Unsupported transport '{transport}' for server '{server_id}'.")
    init_payload = _expand_env(entry.get("init"))
    send_initialized = bool(
      entry.get("send_initialized")
      or entry.get("sendInitialized")
      or entry.get("initialized")
      or False
    )
    enabled = bool(entry.get("enabled", True))
    tags = _string_list(entry.get("tags"))
    metadata = {
      key: value
      for key, value in entry.items()
      if key
      not in {
        "id",
        "serverId",
        "server_id",
        "cmd",
        "command",
        "init",
        "send_initialized",
        "sendInitialized",
        "initialized",
        "enabled",
        "tags",
        "transport",
      }
    }
    servers.append(
      ServerSpec(
        id=server_id,
        cmd=os.path.expandvars(cmd),
        enabled=enabled,
        init=init_payload if isinstance(init_payload, dict) else None,
        send_initialized=send_initialized,
        tags=tags,
        metadata=metadata,
        transport=transport,
      )
    )
  return servers


def _string_value(entry: dict[str, Any], keys: Iterable[str]) -> str | None:
  for key in keys:
    value = entry.get(key)
    if isinstance(value, str) and value.strip():
      return value.strip()
  return None


def _string_list(value: Any) -> list[str]:
  if value is None:
    return []
  if isinstance(value, str):
    return [value]
  if isinstance(value, list):
    return [str(item) for item in value if item is not None]
  return [str(value)]


def _expand_env(value: Any) -> Any:
  if isinstance(value, str):
    return os.path.expandvars(value)
  if isinstance(value, list):
    return [_expand_env(item) for item in value]
  if isinstance(value, dict):
    return {key: _expand_env(item) for key, item in value.items()}
  return value
