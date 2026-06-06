"""
Thin httpx-based REST client. Other modules layer typed helpers on top.
Bodies are dict-in / dict-out so the same client serves both the generated
pydantic models and ad-hoc calls.
"""

from __future__ import annotations

import json
from typing import Any, Mapping

import httpx


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None) -> None:
        super().__init__(f"{code} ({status}): {message}")
        self.status = status
        self.code = code
        self.message = message
        self.details = details


class Client:
    def __init__(
        self,
        base_url: str,
        api_key: str | None = None,
        timeout_s: float = 30.0,
    ) -> None:
        if not base_url:
            raise ValueError("base_url is required")
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._http = httpx.Client(timeout=timeout_s)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def request(
        self,
        method: str,
        path: str,
        *,
        body: Any | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> Any:
        url = f"{self._base_url}{path}"
        all_headers: dict[str, str] = {"content-type": "application/json"}
        if self._api_key:
            all_headers["x-api-key"] = self._api_key
        if headers:
            all_headers.update(headers)
        resp = self._http.request(
            method,
            url,
            content=json.dumps(body) if body is not None else None,
            headers=all_headers,
        )
        text = resp.text
        if not (200 <= resp.status_code < 300):
            code = "HTTP_ERROR"
            message = text[:200]
            details: Any = None
            try:
                parsed = json.loads(text)
                code = parsed.get("code", code)
                message = parsed.get("message", message)
                details = parsed.get("details")
            except json.JSONDecodeError:
                pass
            raise ApiError(resp.status_code, code, message, details)
        if not text:
            return None
        return json.loads(text)
