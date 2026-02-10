# Claude MCP Examples

This repository focuses on routing MCP tools, but you can connect Claude in two common ways.

## Claude Desktop (claude_desktop_config.json)

Claude Desktop reads MCP server definitions from `claude_desktop_config.json`.
See `examples/claude-desktop-config.json` for a minimal example that connects Claude Desktop to `claude mcp serve`.

## Claude API MCP connector (HTTP)

The Claude API can connect to MCP servers over HTTP and expose them as a toolset.
See `examples/claude-mcp-connector.json` for a minimal request payload.
