from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON_SRC = ROOT / "python"
if str(PYTHON_SRC) not in sys.path:
  sys.path.insert(0, str(PYTHON_SRC))

from mcp_tool_router import ToolRouterHub  # noqa: E402


def main() -> int:
  config_path = os.environ.get("OPENCODE_CONFIG", "~/.config/opencode/opencode.json")
  routerd_cmd = os.environ.get("ROUTERD", "node packages/daemon/dist/cli.js")

  hub = ToolRouterHub.from_opencode_config(config_path, routerd_path=routerd_cmd)

  try:
    hub.sync_all()
    query = os.environ.get("QUERY", "summarize the latest report")
    selected = hub.select_tools("hub-demo", query, top_k=10, budget_tokens=1200)
    print("Selected tools:", selected)
  finally:
    hub.close()

  return 0


if __name__ == "__main__":
  raise SystemExit(main())
