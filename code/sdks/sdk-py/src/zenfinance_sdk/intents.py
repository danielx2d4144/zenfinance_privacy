"""
Intent helpers (createIntent / getIntent / wait_for_intent).

Request and response shapes come from the generated pydantic models so
the SDK signatures stay in sync with the server's zod schemas (T-12.3).
"""

from __future__ import annotations

import time
from typing import Mapping

from .client import Client
from .generated.models import IntentAccepted, IntentDetail

TERMINAL_STATUSES = frozenset({"confirmed", "failed"})


class IntentsApi:
    def __init__(self, client: Client) -> None:
        self._client = client

    def create(
        self,
        body: Mapping[str, object],
        idempotency_key: str | None = None,
    ) -> IntentAccepted:
        headers: dict[str, str] = {}
        if idempotency_key:
            headers["idempotency-key"] = idempotency_key
        raw = self._client.request("POST", "/v1/intents", body=body, headers=headers)
        return IntentAccepted.model_validate(raw)

    def get(self, intent_id: str) -> IntentDetail:
        raw = self._client.request("GET", f"/v1/intents/{intent_id}")
        return IntentDetail.model_validate(raw)

    def wait_for(
        self,
        intent_id: str,
        deadline_s: float = 60.0,
        poll_s: float = 0.25,
    ) -> IntentDetail:
        deadline = time.monotonic() + deadline_s
        while time.monotonic() < deadline:
            row = self.get(intent_id)
            status = row.status.value if hasattr(row.status, "value") else row.status
            if status in TERMINAL_STATUSES:
                return row
            time.sleep(poll_s)
        raise RuntimeError(
            f"intent {intent_id} did not reach a terminal state within {deadline_s}s",
        )
