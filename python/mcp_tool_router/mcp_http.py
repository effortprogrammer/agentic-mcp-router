from __future__ import annotations

from dataclasses import dataclass
import json
import urllib.request
from typing import Any


@dataclass
class HttpMcpConfig:
  url: str
  headers: dict[str, str]
  timeout: float
  init_payload: dict | None = None
  send_initialized: bool = False


class HttpMcpClient:
  def __init__(
    self,
    url: str,
    headers: dict[str, str] | None = None,
    timeout: float | None = None,
    init_payload: dict | None = None,
    send_initialized: bool = False,
  ) -> None:
    self._next_id = 1
    self._config = HttpMcpConfig(
      url=url,
      headers=headers or {},
      timeout=timeout if timeout is not None else 30.0,
      init_payload=init_payload,
      send_initialized=send_initialized,
    )
    if init_payload is not None:
      self.request("initialize", init_payload)
      if send_initialized:
        self.notify("initialized", {})

  def request(self, method: str, params: dict | None = None) -> Any:
    request_id = self._next_id
    self._next_id += 1
    payload: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
      payload["params"] = params
    response = self._post(payload, expect_response=True)
    if not isinstance(response, dict):
      raise RuntimeError("Invalid JSON-RPC response")
    if "error" in response:
      raise RuntimeError(f"JSON-RPC error: {response['error']}")
    return response.get("result")

  def notify(self, method: str, params: dict | None = None) -> None:
    payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
    if params is not None:
      payload["params"] = params
    self._post(payload, expect_response=False)

  def tools_list(self) -> dict:
    return self.request("tools/list", {})

  def tools_call(self, name: str, arguments: dict | None = None) -> dict:
    payload = {"name": name, "arguments": arguments or {}}
    return self.request("tools/call", payload)

  def close(self) -> None:
    return None

  def _post(self, payload: dict[str, Any], expect_response: bool) -> Any:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    headers.update(self._config.headers)
    request = urllib.request.Request(self._config.url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=self._config.timeout) as response:
      raw = response.read()
    if not expect_response:
      return None
    if not raw:
      return None
    return json.loads(raw.decode("utf-8"))
