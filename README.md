# MCP Tool Router

Smart tool routing for [OpenCode](https://opencode.ai). Reduces MCP tool context usage
by **~99%** through BM25 search, working-set management, and on-demand tool loading.

## The Problem

When you configure many MCP servers in OpenCode, every tool definition is sent to
the LLM on every turn:

- **50+ MCP tools** ≈ **~67k tokens** just for tool definitions
- Leaves less context for your actual conversation and code

## The Solution

The router sits between OpenCode and your MCP servers, exposing only **3 meta-tools**:

| Tool                  | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `router_select_tools` | Search for relevant tools by query (BM25 or regex) |
| `router_call_tool`    | Call a tool by `{serverId}:{toolName}`             |
| `router_tool_info`    | Inspect a tool's full schema before calling it     |

```
User: "Create a GitHub PR"
  → OpenCode calls: router_select_tools({ query: "github pull request" })
  → Router returns: [{ toolId: "github:create_pull_request", ... }]
  → OpenCode calls: router_call_tool({ toolId: "github:create_pull_request", arguments: {...} })
```

## Quick Start

### 1. Configure your MCP servers

In `~/.config/opencode/opencode.json`, keep your existing MCP servers but set them
to `enabled: false`. Add a single `router` entry:

```json
{
  "mcp": {
    "router": {
      "type": "local",
      "enabled": true,
      "command": ["python3", "-m", "mcp_tool_router.router_mcp_server"]
    },
    "slack": {
      "type": "local",
      "enabled": false,
      "command": ["npx", "@modelcontextprotocol/server-slack"]
    },
    "github": {
      "type": "local",
      "enabled": false,
      "command": ["npx", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "$GITHUB_TOKEN" }
    }
  }
}
```

### 2. Install

```bash
pip install mcp-tool-router
```

Or install from source:

```bash
git clone https://github.com/effortprogrammer/agentic-tool-router.git
cd agentic-tool-router
npm install && npm run build
pip install -e python/
```

### 3. Auto-configure (optional)

Automatically update your OpenCode config — disables existing MCP entries and adds
the router:

```bash
npx @mcp-tool-router/cli opencode install
```

Or with the Python helper:

```bash
python -m mcp_tool_router.opencode_config
```

Options: `--config`, `--router-id`, `--router-command`, `--keep-others`, `--dry-run`.

## Features

### Always-Load Tools

Pin essential tools so they always appear in results without searching:

```bash
export ROUTER_ALWAYS_LOAD="*:read,*:write,*:edit,slack:*"
```

Supports glob patterns:

| Pattern           | Matches                            |
| ----------------- | ---------------------------------- |
| `*:read`          | `read` tool from any server        |
| `slack:*`         | All tools from the `slack` server  |
| `github:create_*` | All `create_*` tools from `github` |

### Regex Search Mode

When you know the exact tool name, use regex mode for precise matching:

```
router_select_tools({ query: "create_pull_request", mode: "regex" })
```

| Mode             | Best For                                           |
| ---------------- | -------------------------------------------------- |
| `bm25` (default) | Natural language queries ("create a PR on GitHub") |
| `regex`          | Exact or pattern-based tool name matching          |

### Tool Introspection

Inspect a tool's full JSON schema before calling it:

```
router_tool_info({ toolId: "github:create_pull_request" })
→ { toolCard: {...}, rawDefinition: { name, description, inputSchema } }
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│  OpenCode                                       │
│  (sees only 3 tools: select, call, info)        │
└────────────────────┬────────────────────────────┘
                     │ MCP stdio
┌────────────────────▼────────────────────────────┐
│  Router MCP Server (Python)                     │
│  - Parses opencode.json for MCP server configs  │
│  - Always-load pattern resolution               │
│  - Tool call proxying                           │
└────────────────────┬────────────────────────────┘
                     │ JSON-RPC stdio
┌────────────────────▼────────────────────────────┐
│  Router Daemon (TypeScript)                     │
│  - BM25 + Regex search engines                  │
│  - Working-set management (pin, TTL, budget)    │
│  - Result reduction (truncation, structured)    │
└────────────────────┬────────────────────────────┘
                     │
        ┌────────────┼────────────┐
   ┌────▼────┐  ┌────▼────┐  ┌───▼─────┐
   │ Slack   │  │ GitHub  │  │ Other   │
   │ MCP     │  │ MCP     │  │ MCP     │
   └─────────┘  └─────────┘  └─────────┘
```

## Configuration

### Environment Variables

| Variable                  | Default                            | Description                                           |
| ------------------------- | ---------------------------------- | ----------------------------------------------------- |
| `OPENCODE_CONFIG`         | `~/.config/opencode/opencode.json` | Path to OpenCode config                               |
| `ROUTERD`                 | auto-detect                        | Override the router daemon command                    |
| `ROUTER_ALWAYS_LOAD`      | _(empty)_                          | Comma-separated glob patterns for always-loaded tools |
| `ROUTER_IGNORE_IDS`       | _(empty)_                          | Comma-separated MCP server IDs to skip                |
| `ROUTER_INCLUDE_DISABLED` | `true`                             | Include disabled MCP entries from config              |
| `ROUTER_MCP_ID`           | _(empty)_                          | Router's own MCP ID (auto-added to ignore list)       |
| `ROUTER_SESSION_ID`       | `default`                          | Session ID for working-set tracking                   |

### Minimum MCP Tool Fields

The router only requires MCP-standard fields:

- `name`
- `description` (optional but recommended)
- `inputSchema` (or `input_schema`)

Missing `tags`, `synonyms`, and `examples` are derived automatically from the
tool name and description.

## Repository Layout

```
packages/
  shared/    # Shared types (ToolCard, SearchQueryInput, etc.)
  core/      # BM25, regex search, tokenizer, working set, result reducer
  daemon/    # tool-routerd JSON-RPC server
  cli/       # CLI helper (opencode install)
python/
  mcp_tool_router/  # Python MCP server + hub + registry
examples/
```

## License

MIT
