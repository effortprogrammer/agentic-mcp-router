# Examples

## Quickstart (Python + stdio daemon)

Run a minimal end-to-end flow (sync -> select -> reduce) using a mock MCP
client and the stdio JSON-RPC daemon.

From the repo root:

```bash
python examples/quickstart.py
```

Notes:
- The script starts the daemon via `npx tsx packages/daemon/src/cli.ts` by
  default. Override with `ROUTERD` if you have a built binary, e.g.
  `ROUTERD="tool-routerd"`.
- If `npx` needs to download `tsx` the first run may take a moment.
