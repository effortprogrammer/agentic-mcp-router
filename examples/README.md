# Examples

## Quickstart (Python + router daemon)

Run a minimal end-to-end flow (sync -> select -> reduce) using a real MCP
HTTP server and the router JSON-RPC daemon.

From the repo root:

```bash
python examples/quickstart.py
```

Notes:
- The script expects `MCP_SERVER_URL` to be set (HTTP MCP server endpoint).
- The script starts the daemon via `node packages/daemon/dist/cli.js` by
  default. Override with `ROUTERD` if needed.
