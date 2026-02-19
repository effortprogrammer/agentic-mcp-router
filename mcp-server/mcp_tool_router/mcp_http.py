from __future__ import annotations

import json
import sys
import threading
from typing import Any

import httpx

_INIT_PARAMS = {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "mcp-tool-router", "version": "0.1.0"},
}

_DEFAULT_CONNECT_TIMEOUT = 10.0
_DEFAULT_READ_TIMEOUT = 30.0
_TOOL_CALL_READ_TIMEOUT = 120.0
_MAX_REINIT_RETRIES = 1


class HttpMcpClient:
    def __init__(self, url: str, headers: dict[str, str] | None = None) -> None:
        self._url = url
        self._extra_headers = dict(headers) if headers else {}
        self._session_id: str | None = None
        self._lock = threading.Lock()
        self._next_id = 1
        self._client = httpx.Client(
            timeout=httpx.Timeout(
                _DEFAULT_READ_TIMEOUT, connect=_DEFAULT_CONNECT_TIMEOUT
            )
        )
        self._initialize()

    def tools_list(self) -> dict:
        return self._post("tools/list", {})

    def tools_call(self, name: str, arguments: dict | None = None) -> dict:
        payload = {"name": name, "arguments": arguments or {}}
        return self._post("tools/call", payload, read_timeout=_TOOL_CALL_READ_TIMEOUT)

    def close(self) -> None:
        self._client.close()

    def _initialize(self) -> None:
        self._post("initialize", _INIT_PARAMS)
        self._notify("notifications/initialized", {})

    def _reserve_id(self) -> int:
        with self._lock:
            request_id = self._next_id
            self._next_id += 1
            return request_id

    def _build_headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            **self._extra_headers,
        }
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id
        return headers

    def _post(
        self,
        method: str,
        params: dict[str, Any],
        *,
        read_timeout: float | None = None,
        _reinit_attempt: int = 0,
    ) -> dict:
        request_id = self._reserve_id()
        body = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        }
        timeout = None
        if read_timeout is not None:
            timeout = httpx.Timeout(read_timeout, connect=_DEFAULT_CONNECT_TIMEOUT)

        try:
            response = self._client.post(
                self._url, json=body, headers=self._build_headers(), timeout=timeout
            )
        except httpx.TimeoutException as exc:
            raise RuntimeError(
                f"HTTP timeout connecting to {self._url}: {exc}"
            ) from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(f"HTTP error connecting to {self._url}: {exc}") from exc

        if (
            response.status_code == 404
            and _reinit_attempt < _MAX_REINIT_RETRIES
            and method != "initialize"
        ):
            self._initialize()
            return self._post(
                method,
                params,
                read_timeout=read_timeout,
                _reinit_attempt=_reinit_attempt + 1,
            )

        if response.status_code >= 400:
            raise RuntimeError(
                f"HTTP {response.status_code} from {self._url}: {response.text[:500]}"
            )

        new_session_id = response.headers.get("mcp-session-id")
        if new_session_id:
            self._session_id = new_session_id

        return self._parse_response(response)

    def _notify(self, method: str, params: dict[str, Any]) -> None:
        body = {"jsonrpc": "2.0", "method": method, "params": params}
        try:
            self._client.post(self._url, json=body, headers=self._build_headers())
        except httpx.HTTPError:
            pass

    def _parse_response(self, response: httpx.Response) -> dict:
        content_type = response.headers.get("content-type", "")

        if "text/event-stream" in content_type:
            return self._parse_sse(response.text)

        try:
            data = response.json()
        except (json.JSONDecodeError, ValueError) as exc:
            raise RuntimeError(f"Invalid JSON from {self._url}: {exc}") from exc

        if "error" in data:
            raise RuntimeError(f"JSON-RPC error: {data['error']}")
        return data.get("result", data)

    def _parse_sse(self, text: str) -> dict:
        for line in text.splitlines():
            if not line.startswith("data: "):
                continue
            payload = line[6:]
            try:
                data = json.loads(payload)
            except (json.JSONDecodeError, ValueError):
                continue
            if "error" in data:
                raise RuntimeError(f"JSON-RPC error: {data['error']}")
            return data.get("result", data)
        raise RuntimeError(
            f"No valid JSON-RPC message in SSE response from {self._url}"
        )
