"""
zenfinance-sdk — Day-12 Python SDK for the privacy lending REST API.

Types live in `.generated.models` and are produced by
datamodel-code-generator from the same openapi.json the API server
emits, so the SDK surface stays in sync with the server's zod schemas.
"""

from .client import Client, ApiError
from .intents import IntentsApi, TERMINAL_STATUSES
from .mcp import McpClient
from .sdk import LendingSdk

__all__ = [
    "Client",
    "ApiError",
    "IntentsApi",
    "TERMINAL_STATUSES",
    "McpClient",
    "LendingSdk",
]
