"""
Day-12 SDK-Py deposit example.

Submits an entry_deposit intent and polls until the protocol confirms it.
Mirrors T-12.2: "run sdk-py/examples/deposit.py; observe deposit succeeds".

Usage:
    API_BASE_URL=http://localhost:8787 \
    API_KEY=day11-local-test-api-key-please-rotate \
    python examples/deposit.py
"""

from __future__ import annotations

import json
import os
import secrets
import sys
from pathlib import Path

# Make the in-tree package importable without an install (mirrors how the
# CI smoke test invokes the script).
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from zenfinance_sdk import LendingSdk  # noqa: E402


def main() -> int:
    base_url = os.environ.get("API_BASE_URL", "http://localhost:8787")
    api_key = os.environ.get("API_KEY", "day11-local-test-api-key-please-rotate")

    with LendingSdk(base_url=base_url, api_key=api_key) as sdk:
        commitment = "0x" + secrets.token_hex(32)
        idem = "sdk-py-example-" + secrets.token_hex(8)

        accepted = sdk.intents.create(
            {
                "kind": "entry_deposit",
                "asset": "USDC",
                "amount": "100000",
                "commitment": commitment,
            },
            idempotency_key=idem,
        )
        print(json.dumps({
            "stage": "accepted",
            "intent_id": str(accepted.intent_id),
            "status": str(accepted.status.value if hasattr(accepted.status, "value") else accepted.status),
        }))

        final = sdk.intents.wait_for(str(accepted.intent_id))
        status = final.status.value if hasattr(final.status, "value") else final.status
        first_job = final.jobs[0] if final.jobs else None
        tx_hash = first_job.tx_hash if first_job else None
        payload = first_job.status_payload if first_job else None
        gas_used = None
        if isinstance(payload, dict):
            gas_used = payload.get("gasUsed")

        print(json.dumps({
            "stage": "terminal",
            "status": str(status),
            "intent_id": str(final.intent_id),
            "failure_reason": final.failure_reason,
            "txHash": tx_hash,
            "gasUsed": gas_used,
        }))

        return 0 if str(status) == "confirmed" else 1


if __name__ == "__main__":
    sys.exit(main())
