# Examples

## Quickstart (Python + router daemon)

Run a minimal end-to-end flow (sync -> select -> reduce) using a real MCP
stdio server and the router JSON-RPC daemon.

From the repo root:

```bash
python examples/quickstart.py
```

Notes:
- The script expects `MCP_SERVER_CMD` to be set (stdio MCP server command).
- The script starts the daemon via `node packages/daemon/dist/cli.js` by
  default. Override with `ROUTERD` if needed.

## Quickstart (OpenCode config)

If you already manage MCP servers in OpenCode, you can reuse that config:

```bash
OPENCODE_CONFIG="~/.config/opencode/opencode.json" python examples/opencode_quickstart.py
```

## Router MCP server (OpenCode)

If OpenCode should connect to a single MCP server (the router), run:

```bash
OPENCODE_CONFIG="~/.config/opencode/opencode.json" \
  python -m mcp_tool_router.router_mcp_server
```

Then register only the router MCP entry in OpenCode, and keep your real MCP
servers disabled so the router can read them directly.

## Auto-config helper

To automatically add the router entry (and disable other MCP servers):

```bash
python -m mcp_tool_router.opencode_config
```
