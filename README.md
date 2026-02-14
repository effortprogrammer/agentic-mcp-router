# MCP Tool Router

Smart tool routing for [OpenCode](https://opencode.ai). Reduces MCP tool context usage
through BM25 search, working-set management, and on-demand tool loading.

## The Problem

When you configure many MCP servers in OpenCode, every tool definition is sent to
the LLM on every turn — leaving less context for your actual conversation and code.

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

**3 commands and you're done:**

```bash
# 1. Install and configure router (auto-updates your OpenCode config)
npx @mcp-tool-router/cli opencode install

# 2. Start OpenCode — it auto-loads the router
# (no manual config needed!)

# 3. Verify it works
# Open Settings → MCP Servers → should see "router" with 3 tools
```

That's it! The router automatically:
- ✅ Disables your existing MCP servers
- ✅ Configures itself as single MCP entry
- ✅ Starts managing all your tools via smart BM25 search

---

### Adding New MCP Servers (general)

```bash
# 1. Edit your OpenCode config (~/.config/opencode/opencode.json)
{
  "mcp": {
    "your-server": {
      "type": "local",
      "enabled": true,
      "command": ["..."],
      "env": {}
    }
  }
}

# 2. Restart OpenCode
# (router reloads config on OpenCode restart)
```

### GitHub MCP setup & test

1) Install server (global 또는 npx 사용)
```bash
npm install -g @modelcontextprotocol/server-github
# 또는 npx @modelcontextprotocol/server-github
```

2) 토큰 준비
```bash
export GITHUB_TOKEN=ghp_your_token   # repo 권한 필요
```

3) OpenCode 설정 추가 (`~/.config/opencode/opencode.json`)
```json
{
  "mcp": {
    "router": {
      "type": "local",
      "enabled": true,
      "command": ["python3", "-m", "mcp_tool_router.router_mcp_server"]
    },
    "github": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "$GITHUB_TOKEN" }
    }
  }
}
```

4) OpenCode 재시작 (hot-reload 없음)

5) 동작 확인 (OpenCode에서 메타 툴 호출)
- `router_select_tools { query: "github pull request" }` → `github:create_pull_request` 등 노출
- `router_tool_info { toolId: "github:create_pull_request" }` → 스키마 확인
- `router_call_tool { toolId: "github:create_pull_request", arguments: {...} }` → 실제 호출

### Manual Config (optional)

If you prefer to configure manually or need custom settings, edit `~/.config/opencode/opencode.json`:

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
      "enabled": false
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

### Install from Source

```bash
git clone https://github.com/effortprogrammer/agentic-tool-router.git
cd agentic-tool-router
npm install && npm run build
pip install -e python/
npx @mcp-tool-router/cli opencode install
```

### Auto-configure Options

```bash
npx @mcp-tool-router/cli opencode install --help
```

| Option | Description |
|---------|-------------|
| `--config <path>` | Path to OpenCode config (default: `~/.config/opencode/opencode.json`) |
| `--router-id <name>` | Router MCP server ID (default: `router`) |
| `--router-command <cmd>` | Override router daemon command |
| `--keep-others` | Don't disable existing MCP servers |
| `--dry-run` | Show changes without applying |

## Features

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

## Token Savings Benchmarks

Actual measurements from a typical setup (5 MCP servers, 33 tools):

### Without Router (Naive)

| MCP Server | Tools | Tokens |
|------------|-------|--------|
| github | 25 | 5,651 |
| context7 | 2 | 791 |
| slack | 4 | 499 |
| grep_app | 1 | 622 |
| websearch | 1 | 284 |
| **Total** | **33** | **7,847** |

### With Router

| Component | Tokens |
|-----------|--------|
| Meta tools (select, call, info) | ~450 |
| Working set (budget=1500) | ~1,500 |
| **Total** | **~1,950** |

### Savings

| Metric | Value |
|--------|-------|
| Per-turn reduction | **7,847 → 1,950 = 75%** |
| 20-turn conversation | **~120,000 tokens saved** |

> **Note**: Actual savings scale with the number of configured tools — more MCP servers = greater reduction.

### Measurement Method

Token estimation follows the standard formula:

```
tokens = ceil(utf8_bytes / 4)  // 4 bytes ≈ 1 token
per_tool_overhead = max(8, estimated + 12)
```

To measure your own setup:

```bash
# Using the compare script
MCP_SERVER_CMD="npx @your/mcp-server" python examples/compare_mcp.py "your query"

# Or inspect router_select_tools response
router_select_tools({ query: "...", budgetTokens: 100000, includeTools: true })
# → Returns full tool definitions for analysis
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
│  - Tool call proxying + result reduction          │
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

| Variable                  | Default                            | Description                                     |
| ------------------------- | ---------------------------------- | ----------------------------------------------- |
| `OPENCODE_CONFIG`         | `~/.config/opencode/opencode.json` | Path to OpenCode config                         |
| `ROUTERD`                 | auto-detect                        | Override the router daemon command              |
| `ROUTER_IGNORE_IDS`       | _(empty)_                          | Comma-separated MCP server IDs to skip          |
| `ROUTER_INCLUDE_DISABLED` | `true`                             | Include disabled MCP entries from config        |
| `ROUTER_MCP_ID`           | _(empty)_                          | Router's own MCP ID (auto-added to ignore list) |
| `ROUTER_SESSION_ID`       | `default`                          | Session ID for working-set tracking             |

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
