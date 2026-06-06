"""One-shot factory mirroring the TS SDK's LendingSdk class."""

from __future__ import annotations

from .client import Client
from .intents import IntentsApi
from .mcp import McpClient


class LendingSdk:
    def __init__(
        self,
        base_url: str,
        api_key: str | None = None,
        timeout_s: float = 30.0,
    ) -> None:
        self.client = Client(base_url=base_url, api_key=api_key, timeout_s=timeout_s)
        self.intents = IntentsApi(self.client)
        self.mcp = McpClient(self.client)

    def close(self) -> None:
        self.client.close()

    def __enter__(self) -> "LendingSdk":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
