from __future__ import annotations

import itertools
from typing import Any

from .client import Client

_id_seq = itertools.count(1)


class McpClient:
    """JSON-RPC + HTTP convenience wrapper around /v1/mcp + /v1/mcp/tools."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def tools_http(self) -> dict[str, Any]:
        return self._client.request("GET", "/v1/mcp/tools")

    def tools_list(self) -> dict[str, Any]:
        r = self._client.request(
            "POST",
            "/v1/mcp",
            body={"jsonrpc": "2.0", "id": next(_id_seq), "method": "tools/list"},
        )
        if r.get("error"):
            raise RuntimeError(f"MCP tools/list error: {r['error']}")
        return r["result"]

    def tools_call(self, name: str, args: dict[str, Any]) -> Any:
        r = self._client.request(
            "POST",
            "/v1/mcp",
            body={
                "jsonrpc": "2.0",
                "id": next(_id_seq),
                "method": "tools/call",
                "params": {"name": name, "arguments": args},
            },
        )
        if r.get("error"):
            raise RuntimeError(f"MCP tools/call({name}) error: {r['error']}")
        return r.get("result")
