from __future__ import annotations

from dataclasses import dataclass
import json
import os
import queue
import shlex
import subprocess
import threading
from typing import Any


@dataclass
class StdioMcpConfig:
    server_cmd: str
    init_payload: dict | None = None
    send_initialized: bool = False
    env: dict[str, str] | None = None


class _StdioJsonRpcClient:
    def __init__(self, argv: list[str], env: dict[str, str] | None = None) -> None:
        proc_env: dict[str, str] | None = None
        if env:
            proc_env = {**os.environ, **env}
        self._proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=proc_env,
        )
        self._lock = threading.Lock()
        self._pending: dict[int, queue.Queue[dict]] = {}
        self._next_id = 1
        self._closed = False
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def request(self, method: str, params: dict | None = None) -> Any:
        if self._closed:
            raise RuntimeError("JSON-RPC client is closed")
        request_id, pending = self._reserve_id()
        payload: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            payload["params"] = params
        self._write_payload(payload)
        response = self._await_response(pending)
        if "error" in response:
            raise RuntimeError(f"JSON-RPC error: {response['error']}")
        return response.get("result")

    def notify(self, method: str, params: dict | None = None) -> None:
        if self._closed:
            raise RuntimeError("JSON-RPC client is closed")
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        self._write_payload(payload)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            if self._proc.stdin is not None:
                self._proc.stdin.close()
        finally:
            self._proc.terminate()
            self._reader.join(timeout=1)

    def _write_payload(self, payload: dict[str, Any]) -> None:
        line = json.dumps(payload, separators=(",", ":"), sort_keys=True)
        assert self._proc.stdin is not None
        try:
            self._proc.stdin.write(line + "\n")
            self._proc.stdin.flush()
        except Exception as exc:
            self._fail_all_pending(f"Failed to write request: {exc}")
            raise

    def _reserve_id(self) -> tuple[int, queue.Queue[dict]]:
        with self._lock:
            request_id = self._next_id
            self._next_id += 1
            pending = queue.Queue(maxsize=1)
            self._pending[request_id] = pending
            return request_id, pending

    def _await_response(self, pending: queue.Queue[dict]) -> dict:
        return pending.get()

    def _read_loop(self) -> None:
        assert self._proc.stdout is not None
        for raw in self._proc.stdout:
            line = raw.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            response_id = message.get("id")
            if response_id is None:
                continue
            with self._lock:
                pending = self._pending.pop(response_id, None)
            if pending is not None:
                pending.put(message)
        self._closed = True
        self._fail_all_pending("MCP server closed")

    def _fail_all_pending(self, reason: str) -> None:
        with self._lock:
            pending = list(self._pending.values())
            self._pending.clear()
        for item in pending:
            item.put({"error": {"message": reason}})


class StdioMcpClient:
    def __init__(
        self,
        server_cmd: str,
        init_payload: dict | None = None,
        send_initialized: bool = False,
        env: dict[str, str] | None = None,
    ) -> None:
        self._config = StdioMcpConfig(
            server_cmd=server_cmd,
            init_payload=init_payload,
            send_initialized=send_initialized,
            env=env,
        )
        argv = shlex.split(server_cmd)
        self._rpc = _StdioJsonRpcClient(argv, env=env)
        if init_payload is not None:
            self._rpc.request("initialize", init_payload)
            if send_initialized:
                self._rpc.notify("initialized", {})

    def tools_list(self) -> dict:
        return self._rpc.request("tools/list", {})

    def tools_call(self, name: str, arguments: dict | None = None) -> dict:
        payload = {"name": name, "arguments": arguments or {}}
        return self._rpc.request("tools/call", payload)

    def close(self) -> None:
        self._rpc.close()
