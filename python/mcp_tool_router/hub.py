from __future__ import annotations

from typing import Any, Iterable

from .mcp_stdio import StdioMcpClient
from .registry import ServerRegistry, ServerSpec
from .router import ToolRouter


class ToolRouterHub:
  def __init__(self, registry: ServerRegistry, router: ToolRouter, auto_sync: bool = True) -> None:
    self._registry = registry
    self._router = router
    self._auto_sync = auto_sync
    self._clients: dict[str, object] = {}
    self._synced: set[str] = set()

  @classmethod
  def from_yaml(cls, path: str, routerd_path: str | None = None, auto_sync: bool = True) -> "ToolRouterHub":
    registry = ServerRegistry.from_yaml(path)
    router = ToolRouter(routerd_path=routerd_path)
    return cls(registry, router, auto_sync=auto_sync)

  @property
  def registry(self) -> ServerRegistry:
    return self._registry

  def list_servers(self) -> list[ServerSpec]:
    return self._registry.list()

  def sync_all(self) -> None:
    for server in self._registry.enabled():
      self.sync_server(server.id)

  def sync_missing(self) -> None:
    for server in self._registry.enabled():
      if server.id not in self._synced:
        self.sync_server(server.id)

  def sync_server(self, server_id: str) -> None:
    server = self._require_server(server_id)
    if not server.enabled:
      raise ValueError(f"Server '{server_id}' is disabled.")
    client = self._ensure_client(server)
    self._router.sync_from_mcp(server_id, client)
    self._synced.add(server_id)

  def select_tools(
    self,
    session_id: str,
    query: str,
    top_k: int = 20,
    budget_tokens: int = 1500,
    sync: bool | None = None,
  ) -> list[str]:
    if sync is None:
      sync = self._auto_sync
    if sync:
      self.sync_missing()
    return self._router.select_tools(session_id, query, top_k=top_k, budget_tokens=budget_tokens)

  def call_tool(self, tool_id: str, arguments: dict | None = None) -> dict:
    server_id, tool_name = _split_tool_id(tool_id)
    server = self._require_server(server_id)
    client = self._ensure_client(server)
    return client.tools_call(tool_name, arguments)

  def call_tool_name(self, server_id: str, tool_name: str, arguments: dict | None = None) -> dict:
    server = self._require_server(server_id)
    client = self._ensure_client(server)
    return client.tools_call(tool_name, arguments)

  def close(self) -> None:
    for client in self._clients.values():
      client.close()
    self._clients.clear()
    self._router.close()

  def _require_server(self, server_id: str) -> ServerSpec:
    server = self._registry.get(server_id)
    if not server:
      raise KeyError(f"Unknown server '{server_id}'.")
    return server

  def _ensure_client(self, server: ServerSpec) -> object:
    client = self._clients.get(server.id)
    if client is not None:
      return client
    if server.transport != "stdio":
      raise ValueError(f"Unsupported transport '{server.transport}' for server '{server.id}'. stdio only.")
    if not server.cmd:
      raise ValueError(f"Server '{server.id}' is missing cmd.")
    client = StdioMcpClient(
      server.cmd,
      init_payload=server.init,
      send_initialized=server.send_initialized,
    )
    self._clients[server.id] = client
    return client


def _split_tool_id(tool_id: str) -> tuple[str, str]:
  if ":" not in tool_id:
    raise ValueError(f"Invalid toolId '{tool_id}'. Expected '{{serverId}}:{{toolName}}'.")
  server_id, tool_name = tool_id.split(":", 1)
  if not server_id or not tool_name:
    raise ValueError(f"Invalid toolId '{tool_id}'. Expected '{{serverId}}:{{toolName}}'.")
  return server_id, tool_name
