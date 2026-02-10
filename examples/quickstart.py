from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON_SRC = ROOT / "python"
if str(PYTHON_SRC) not in sys.path:
  sys.path.insert(0, str(PYTHON_SRC))

from mcp_tool_router import ToolRouter  # noqa: E402


class MockMcpClient:
  def tools_list(self) -> dict:
    return {
      "tools": [
        {
          "name": "weather.get_forecast",
          "description": "Get a short weather forecast for a city.",
          "inputSchema": {
            "type": "object",
            "properties": {
              "city": {"type": "string", "description": "City name"},
              "days": {"type": "integer", "description": "Number of days"}
            },
            "required": ["city"]
          },
          "annotations": {"readOnlyHint": True, "tags": ["weather", "forecast"]}
        },
        {
          "name": "calendar.create_event",
          "description": "Create a calendar event.",
          "inputSchema": {
            "type": "object",
            "properties": {
              "title": {"type": "string", "description": "Event title"},
              "start": {"type": "string", "description": "Start time (ISO8601)"},
              "end": {"type": "string", "description": "End time (ISO8601)"}
            },
            "required": ["title", "start"]
          },
          "annotations": {"destructiveHint": True, "tags": ["calendar"]}
        },
        {
          "name": "web.search",
          "description": "Search the web.",
          "inputSchema": {
            "type": "object",
            "properties": {
              "query": {"type": "string", "description": "Search query"},
              "top_k": {"type": "integer", "description": "Number of results"}
            },
            "required": ["query"]
          },
          "annotations": {"openWorldHint": True, "tags": ["search", "web"]}
        }
      ]
    }


def main() -> int:
  routerd_cmd = os.environ.get("ROUTERD", "npx tsx packages/daemon/src/cli.ts")
  router = ToolRouter(routerd_path=routerd_cmd)

  try:
    client = MockMcpClient()
    router.sync_from_mcp("mock", client)

    session_id = "demo-session"
    selected = router.select_tools(session_id, "weather in seoul", top_k=5, budget_tokens=800)
    print("Selected tools:", selected)

    if selected:
      router.mark_tool_used(session_id, selected[0])

    raw_result = {
      "content": [
        {"type": "text", "text": "Forecast for Seoul: Clear, 6C. Next day: Cloudy, 4C."}
      ],
      "structuredContent": {
        "city": "Seoul",
        "days": [
          {"day": "Tue", "summary": "Clear", "tempC": 6},
          {"day": "Wed", "summary": "Cloudy", "tempC": 4}
        ]
      }
    }

    reduced = router.reduce_result(selected[0] if selected else None, raw_result)
    print("Reduced result:")
    print(json.dumps(reduced, indent=2))
  finally:
    router.close()

  return 0


if __name__ == "__main__":
  raise SystemExit(main())
