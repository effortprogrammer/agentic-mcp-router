"""
Measure exact token usage for MCP tool definitions with and without the router.

Counts tokens using Anthropic (messages.count_tokens) and OpenAI (tiktoken) when
available. Falls back to byte/4 approximation when a tokenizer is missing.

Usage:
  MCP_SERVER_CMD="npx @your/mcp-server" \
  python examples/measure_tokens.py \
    --anthropic-model claude-3-5-sonnet-20241022 \
    --openai-model gpt-4o-mini

Environment:
  MCP_SERVER_CMD (required)   : stdio MCP server command
  MCP_SERVER_ID (optional)    : default "mcp"
  ANTHROPIC_API_KEY (optional): enable Anthropic counting
  OPENAI_API_KEY (optional)   : not required for tiktoken-only counting
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional


ROOT = Path(__file__).resolve().parents[1]
PYTHON_SRC = ROOT / "python"
if str(PYTHON_SRC) not in sys.path:
    sys.path.insert(0, str(PYTHON_SRC))

try:
    import anthropic  # type: ignore
except Exception:  # pragma: no cover - optional
    anthropic = None

try:
    import tiktoken  # type: ignore
except Exception:  # pragma: no cover - optional
    tiktoken = None

from mcp_tool_router import StdioMcpClient  # noqa: E402
from mcp_tool_router.router import _toolcard_from_mcp  # noqa: E402


def warn(msg: str) -> None:
    print(f"[warn] {msg}", file=sys.stderr)


def serialize(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def approx_tokens_from_bytes(text: str) -> int:
    return max(1, (len(text.encode("utf-8")) + 3) // 4)


def count_anthropic(text: str, model: str) -> Optional[int]:
    if anthropic is None:
        warn("Anthropic not installed; falling back to approx")
        return None
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        warn("ANTHROPIC_API_KEY not set; falling back to approx")
        return None
    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.count_tokens(
        model=model,
        messages=[{"role": "user", "content": text}],
    )
    return resp.input_tokens


def count_openai(text: str, model: str) -> Optional[int]:
    if tiktoken is None:
        warn("tiktoken not installed; falling back to approx")
        return None
    try:
        enc = tiktoken.encoding_for_model(model)
    except Exception:
        enc = tiktoken.get_encoding("cl100k_base")
    return len(enc.encode(text))


def load_tools(server_cmd: str, server_id: str) -> list[dict[str, Any]]:
    client = StdioMcpClient(server_cmd)
    try:
        tools_payload = client.tools_list()
        tools = (
            tools_payload.get("tools", [])
            if isinstance(tools_payload, dict)
            else (tools_payload or [])
        )
        cards = []
        for tool in tools:
            card = _toolcard_from_mcp(server_id, tool)
            if card:
                cards.append(card)
        return cards
    finally:
        client.close()


def _split_tool_id(tool_id: str) -> tuple[str, str]:
    if ":" not in tool_id:
        raise ValueError("toolId must be serverId:toolName")
    server_id, tool_name = tool_id.split(":", 1)
    return server_id, tool_name


def build_router_meta() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "router_select_tools",
                "description": "",
                "parameters": {},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "router_call_tool",
                "description": "",
                "parameters": {},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "router_tool_info",
                "description": "",
                "parameters": {},
            },
        },
    ]


def measure(
    payload: Any, anthropic_model: Optional[str], openai_model: Optional[str]
) -> dict[str, Optional[int]]:
    text = serialize(payload)
    return {
        "bytes": len(text.encode("utf-8")),
        "approx": approx_tokens_from_bytes(text),
        "anthropic": count_anthropic(text, anthropic_model)
        if anthropic_model
        else None,
        "openai": count_openai(text, openai_model) if openai_model else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Measure token usage for MCP tools (naive vs router meta)"
    )
    parser.add_argument(
        "--mcp-server-cmd",
        default=os.environ.get("MCP_SERVER_CMD"),
        help="stdio MCP server command (env: MCP_SERVER_CMD)",
    )
    parser.add_argument(
        "--mcp-server-id",
        default=os.environ.get("MCP_SERVER_ID", "mcp"),
        help="MCP server id",
    )
    parser.add_argument(
        "--anthropic-model",
        default=os.environ.get("ANTHROPIC_MODEL"),
        help="Anthropic model for exact counting",
    )
    parser.add_argument(
        "--openai-model",
        default=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        help="OpenAI model for tiktoken counting",
    )
    parser.add_argument(
        "--assert-tool",
        action="append",
        help="Require the toolId (serverId:toolName) to exist",
    )
    parser.add_argument(
        "--call-tool",
        help="Call the given toolId (serverId:toolName) to verify invocation",
    )
    parser.add_argument(
        "--call-args",
        default="{}",
        help="JSON arguments for --call-tool",
    )
    args = parser.parse_args()

    if not args.mcp_server_cmd:
        parser.error("MCP_SERVER_CMD or --mcp-server-cmd is required")

    naive = load_tools(args.mcp_server_cmd, args.mcp_server_id)

    if args.assert_tool:
        have = {c.get("toolId") for c in naive}
        missing = [t for t in args.assert_tool if t not in have]
        if missing:
            print("Missing tools:", ", ".join(missing), file=sys.stderr)
            return 1

    if args.call_tool:
        server_id, tool_name = _split_tool_id(args.call_tool)
        if server_id != args.mcp_server_id:
            warn("call_tool serverId differs from MCP_SERVER_ID; proceeding anyway")
        try:
            call_args = json.loads(args.call_args)
        except json.JSONDecodeError as exc:
            print(f"Invalid JSON for --call-args: {exc}", file=sys.stderr)
            return 1
        client = StdioMcpClient(args.mcp_server_cmd)
        try:
            result = client.tools_call(tool_name, call_args)
            print("Call result:", serialize(result))
        finally:
            client.close()
    meta = build_router_meta()

    naive_metrics = measure(naive, args.anthropic_model, args.openai_model)
    meta_metrics = measure(meta, args.anthropic_model, args.openai_model)

    # Warn if exact counts are missing
    if args.anthropic_model and naive_metrics.get("anthropic") is None:
        warn("Anthropic tokens unavailable; showing approx instead")
    if args.openai_model and naive_metrics.get("openai") is None:
        warn("OpenAI tokens unavailable; showing approx instead")

    def fmt(label: str, m: dict[str, Optional[int]]):
        anth = m["anthropic"]
        oai = m["openai"]
        return (
            f"{label}:\n"
            f"  bytes      : {m['bytes']:,}\n"
            f"  approx tok : {m['approx']:,}\n"
            f"  anthropic  : {anth if anth is not None else 'n/a'}\n"
            f"  openai     : {oai if oai is not None else 'n/a'}\n"
        )

    print(fmt("Naive (all tools)", naive_metrics))
    print(fmt("Router meta (3 tools)", meta_metrics))

    # If both counts exist, show savings
    for key, label in [
        ("approx", "approx"),
        ("anthropic", "anthropic"),
        ("openai", "openai"),
    ]:
        n = naive_metrics.get(key)
        r = meta_metrics.get(key)
        if n and r:
            saved = (1 - r / n) * 100
            print(f"Saving ({label}): {saved:.1f}% ({n:,} → {r:,})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
