# Lending Protocol — API Contract (Day 12)

The data-API is the single external surface the dapp, the LLM agent, and
external integrators use. This document captures what's stable as of Day 12
G3, plus the rules clients should follow.

The machine-readable contracts live alongside this doc:

- [`openapi.json`](./openapi.json) — OpenAPI 3.1 spec for `/v1/*`. Generated from
  the data-API's zod schemas; SDKs are generated from this file.
- [`mcp-catalog.json`](./mcp-catalog.json) — JSON-RPC 2.0 tool catalog served at
  `POST /v1/mcp` and via the `LendingSdk.mcp.toolsList()` SDK helper.

## 1. Base URL & versioning

| Environment | Base URL              | Status        |
|-------------|-----------------------|---------------|
| Local       | `http://localhost:8787` | live (Day 11+) |
| Goldsky/dev | `TBD`                 | Day 17 cut    |

The path prefix `/v1` is permanent. Breaking changes get a new prefix; the
previous version stays up for at least one release window.

## 2. Authentication

All `/v1/intents*` and `/v1/mcp` endpoints require:

```
X-API-Key: <your-key>
```

Health and OpenAPI are public:

- `GET /v1/health`
- `GET /v1/openapi.json`

Missing or unknown keys return `401 { code: "UNAUTHORIZED", retryable: false }`.

## 3. Submitting an intent

```
POST /v1/intents
Content-Type: application/json
X-API-Key: <key>
Idempotency-Key: <client-chosen-string>     # strongly recommended
```

Body is one of the 10 discriminated intent kinds (see `openapi.json`
`#/components/schemas/AnyIntent`). The server responds `202 Accepted`:

```jsonc
{
  "intent_id": "0c7f6...",
  "status": "received",
  "failure_reason": null
}
```

`intent_id` is a UUIDv4 the client uses to poll status. The handler runs
asynchronously; the response returns as soon as the intent is durably
persisted.

### 3.1 Idempotency

If two requests share the same `Idempotency-Key`:

- the first request's response body is returned to subsequent requests, with
  the original status code
- the server guarantees only one chain submission per key

The implementation uses an atomic `INSERT ... ON CONFLICT DO NOTHING
RETURNING` claim on `idempotency_keys`, so a 10-way concurrent race
deterministically produces one winning row + nine 202 replays.

> **G3.3** asserts this with 10 parallel POSTs sharing one key: all 10
> responses carry the same `intent_id` and exactly one on-chain tx fires.

### 3.2 Polling

```
GET /v1/intents/{id}
```

Returns:

```jsonc
{
  "intent_id": "0c7f6...",
  "status": "received | proving | userop_pending | confirmed | failed",
  "failure_reason": null,
  "created_at": "2026-06-06T19:14:33Z",
  "updated_at": "2026-06-06T19:14:41Z",
  "jobs": [
    {
      "id": "8f...",
      "tx_hash": "0xab...",
      "status_payload": { "blockNumber": "863", "gasUsed": "92044" },
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

The SDKs implement `waitFor(id)` that polls every 500 ms until `status` is
`confirmed` or `failed`.

### 3.3 Intent lifecycle

```
            ┌──── proving ────► userop_pending ──► confirmed
received ───┤
            └──── failed  (any stage may transition to failed on error)
```

Today only `entry_deposit` reaches `confirmed` for real. The other 9 kinds
are accepted and recorded but the handler stubs the chain leg pending
Day 13.

## 4. Errors

All non-2xx responses use:

```jsonc
{
  "code": "VALIDATION_ERROR | UNAUTHORIZED | NOT_FOUND | INTERNAL",
  "message": "Human-readable detail",
  "retryable": true|false,
  "details": { ... }     // optional, present on VALIDATION_ERROR
}
```

`retryable: false` means the same payload will fail again — fix it before
retrying. `retryable: true` means transient (e.g. upstream RPC blip); back
off and retry with the **same** `Idempotency-Key`.

## 5. The MCP surface

The LLM agent talks to the API exclusively through MCP. The catalog
([`mcp-catalog.json`](./mcp-catalog.json)) exposes 18 tools:

- **5 discovery tools** (`assets.list`, `market.list`, `market.get`,
  `oracle.price`, `liquidations.scan`) — no session needed
- **2 position-read tools** (`position.list`, `position.previewAction`)
- **10 `action.<kind>` tools** — one per intent kind in §3
- **1 observability tool** (`intent.status`)

JSON-RPC transport:

```
POST /v1/mcp
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "action.entry_deposit", "arguments": { ... } } }
```

`action.*` tools are wrappers around `POST /v1/intents` — the response
contains the same `intent_id`, and the same polling rules apply.

## 6. Rate limits

There are no hard rate limits in the Day-12 build. The relayer is the
bottleneck: the chain section is serialized through a single-flight mutex,
so concurrent submitters are queued, not rejected. Sustained throughput
target is ≥ 5 intents/s; pre-Day-19 expect bursts to back-pressure.

## 7. Subgraph SLO

The off-chain subgraph indexes every event from `PrivacyEntry`,
`AssetRegistry`, `ShieldedSupplyPool`, `ShieldedPositionPool`,
`InsuranceFund`, and `Oracle`. G3.4 measures the time between an intent's
on-chain confirmation and the commitment showing up in the subgraph:

- target: **p95 ≤ 30 s** across a 20-intent burst
- Day-12 observed: **p95 ≈ 5 s** (local Anvil stack)

The subgraph is the canonical read path for everything past
`confirmed`; the data-API never returns indexed state directly.

## 8. SDK quick start

TypeScript:

```ts
import { LendingSdk } from "@lending/sdk-ts";

const sdk = new LendingSdk({
  baseUrl: "http://localhost:8787",
  apiKey: process.env.API_KEY!,
});

const accepted = await sdk.intents.create(
  { kind: "entry_deposit", asset: "USDC", amount: "100000", commitment: "0x..." },
  { idempotencyKey: "demo-1" },
);
const final = await sdk.intents.waitFor(accepted.intent_id);
```

Python:

```python
from zenfinance_sdk import LendingSdk

with LendingSdk(base_url="http://localhost:8787", api_key=os.environ["API_KEY"]) as sdk:
    accepted = sdk.intents.create(
        {"kind": "entry_deposit", "asset": "USDC", "amount": "100000", "commitment": "0x..."},
        idempotency_key="demo-1",
    )
    final = sdk.intents.wait_for(accepted["intent_id"])
```

Both SDKs are generated from `openapi.json` — never edit
`src/generated/**` by hand; regen with `npm run regen` /
`scripts/regen.sh`.
