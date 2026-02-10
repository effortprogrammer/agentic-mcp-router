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
from mcp_tool_router.router import _toolcard_from_mcp  # noqa: E402


def estimate_tokens_from_text(text: str) -> int:
  return max(1, (len(text.encode("utf-8")) + 3) // 4)


def estimate_tool_tokens(tool: dict) -> int:
  args = tool.get("args") or []
  examples = tool.get("examples") or []
  parts = [
    tool.get("toolId", ""),
    tool.get("toolName", ""),
    tool.get("title", "") or "",
    tool.get("description", "") or "",
    " ".join(tool.get("tags") or []),
    " ".join(tool.get("synonyms") or []),
    " ".join(
      f"{arg.get('name', '')} {arg.get('description', '')} {arg.get('typeHint', '')} {arg.get('example', '')}"
      for arg in args
    ),
    " ".join(f"{ex.get('query', '')} {ex.get('callHint', '')}" for ex in examples),
    " ".join(tool.get("authHint") or []),
    tool.get("sideEffect") or "",
    tool.get("costHint") or "",
  ]
  estimate = estimate_tokens_from_text(" ".join(parts))
  return max(8, estimate + 12)


def main() -> int:
  server_cmd = os.environ.get("MCP_SERVER_CMD")
  if not server_cmd:
    print("Set MCP_SERVER_CMD to the MCP server command.")
    print("Example: MCP_SERVER_CMD='npx @your/mcp-server --stdio' python examples/compare_mcp.py \"query\"")
    return 1

  server_id = os.environ.get("MCP_SERVER_ID", "mcp")
  routerd_cmd = os.environ.get("ROUTERD", "node packages/daemon/dist/cli.js")
  query = " ".join(sys.argv[1:]).strip() or os.environ.get("QUERY", "help me with this task")

  init_payload = None
  init_raw = os.environ.get("MCP_INIT")
  if init_raw:
    init_payload = json.loads(init_raw)
  send_initialized = os.environ.get("MCP_INITIALIZED", "").lower() in {"1", "true", "yes"}

  client = StdioMcpClient(server_cmd, init_payload=init_payload, send_initialized=send_initialized)
  router = ToolRouter(routerd_path=routerd_cmd)

  try:
    tools_payload = client.tools_list()
    tools = tools_payload.get("tools", []) if isinstance(tools_payload, dict) else (tools_payload or [])

    tool_cards = []
    for tool in tools:
      card = _toolcard_from_mcp(server_id, tool)
      if card:
        tool_cards.append(card)

    naive_tokens = sum(estimate_tool_tokens(card) for card in tool_cards)
    naive_count = len(tool_cards)

    router.sync_from_mcp(server_id, client)
    selected_ids = router.select_tools("compare-session", query, top_k=20, budget_tokens=1500)
    selected = [card for card in tool_cards if card.get("toolId") in set(selected_ids)]
    selected_tokens = sum(estimate_tool_tokens(card) for card in selected)

    print("Naive tools:", naive_count)
    print("Naive token estimate:", naive_tokens)
    print("Router-selected tools:", len(selected_ids))
    print("Router token estimate:", selected_tokens)
    print("Selected tool IDs:", selected_ids)
  finally:
    router.close()
    client.close()

  return 0


if __name__ == "__main__":
  raise SystemExit(main())
