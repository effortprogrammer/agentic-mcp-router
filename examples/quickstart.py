from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON_SRC = ROOT / "python"
if str(PYTHON_SRC) not in sys.path:
  sys.path.insert(0, str(PYTHON_SRC))

from mcp_tool_router import StdioMcpClient, ToolRouter  # noqa: E402


def main() -> int:
  routerd_cmd = os.environ.get("ROUTERD", "node packages/daemon/dist/cli.js")
  server_id = os.environ.get("MCP_SERVER_ID", "mcp")
  init_payload = None
  init_raw = os.environ.get("MCP_INIT")
  if init_raw:
    init_payload = json.loads(init_raw)
  send_initialized = os.environ.get("MCP_INITIALIZED", "").lower() in {"1", "true", "yes"}

  server_cmd = os.environ.get("MCP_SERVER_CMD")
  if not server_cmd:
    print("Set MCP_SERVER_CMD for stdio transport.")
    return 1
  client = StdioMcpClient(
    server_cmd,
    init_payload=init_payload,
    send_initialized=send_initialized,
  )

  router = ToolRouter(routerd_path=routerd_cmd)

  try:
    router.sync_from_mcp(server_id, client)

    session_id = "demo-session"
    query = os.environ.get("QUERY", "summarize the latest report")
    selected = router.select_tools(session_id, query, top_k=5, budget_tokens=800)
    print("Selected tools:", selected)

    if selected:
      router.mark_tool_used(session_id, selected[0])
  finally:
    client.close()
    router.close()

  return 0


if __name__ == "__main__":
  raise SystemExit(main())
