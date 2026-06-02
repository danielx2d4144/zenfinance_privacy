# Subsystem 06 — Data Layer (Subgraph + REST API + MCP Server)

## 1. Purpose

**One indexing layer, three faces.** A Goldsky subgraph indexes all
on-chain state; a REST API exposes structured market data for agents and
3rd-party integrators; an MCP server exposes typed tools for LLM-driven
agents. All three are powered by the same underlying GraphQL backend.

This is the **most important subsystem for agent accessibility** — it's
the surface area LLMs actually interact with.

## 2. The three faces

```
                      Goldsky GraphQL
                        (private API)
                              ▲
                              │ pulls
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ▼                 ▼                 ▼
       REST API           MCP server        Human dapp
       /v1/markets        ListTools          (Subsystem 07)
       /v1/positions      CallTool
       /v1/liquidations
       (for agents +
        3rd parties)
```

## 3. Subgraph schema (Goldsky)

Key entities:

```graphql
type Market @entity {
  id: ID!                          # 'USDC' or 'cbBTC'
  totalSupply: BigInt!
  totalBorrow: BigInt!
  supplyIndex: BigInt!
  borrowIndex: BigInt!
  utilizationBps: Int!
  supplyRateBps: Int!
  borrowRateBps: Int!
  lastAccrual: BigInt!
}

type Commitment @entity {
  id: ID!                          # 32-byte commitment value
  pool: String!                    # 'supply' or 'borrow'
  leafIndex: Int!
  insertedAt: BigInt!
  spent: Boolean!                  # true if the nullifier has been published
  spentAt: BigInt
}

type LiquidationPosition @entity {
  id: ID!                          # commitment ID
  liquidationPrice: BigInt!
  active: Boolean!
  insertedAt: BigInt!
  updatedAt: BigInt!
}

type LiquidationEvent @entity {
  id: ID!                          # txHash-logIndex
  targetCommitment: Bytes!
  liquidator: Bytes!
  debtCovered: BigInt!
  collateralSeized: BigInt!
  insuranceFundShare: BigInt!
  timestamp: BigInt!
}

type Aggregation @entity {
  id: ID!                          # domain-aggId
  domainId: Int!
  aggregationId: BigInt!
  root: Bytes!
  postedAt: BigInt!
}

type Policy @entity {
  id: ID!                          # policyId
  owner: Bytes!
  agentPubkey: Bytes!
  spendingCapPerEpoch: BigInt!
  hfFloorBps: Int!
  expiresAt: BigInt!
  active: Boolean!
}

type AgentSession @entity {
  id: ID!                          # accountAddr-sessionId
  account: Bytes!
  policyId: BigInt!
  agentPubkey: Bytes!
  expiresAt: BigInt!
  revoked: Boolean!
}

type InsuranceFundBalance @entity {
  id: ID!                          # token address
  balance: BigInt!
  totalReceived: BigInt!
  totalPaid: BigInt!
}
```

## 4. REST API

Structured, paginated, agent-friendly. Lives at `api.our-domain/v1`.

```
GET  /v1/markets                          # list both markets with stats
GET  /v1/markets/{symbol}                 # single market details
GET  /v1/liquidations?priceBelow=...      # current scan
GET  /v1/liquidations/{commitment}        # one position's details

GET  /v1/positions/{ownerAddress}         # all positions owned (via AgentAccount derivations)
GET  /v1/policies/{policyId}              # policy details
GET  /v1/agents/{agentAddress}/sessions   # active sessions for an agent pubkey

POST /v1/proofs                           # submit a proof (paid; routes to Kurier)
GET  /v1/proofs/{jobId}                   # poll status

GET  /v1/oracle/price/{feed}              # latest Stork price + freshness
GET  /v1/health                           # protocol health (paused state, last accrual, etc.)
```

Authentication: API keys for high-volume callers; otherwise rate-limited
public access.

Response format: JSON with strict OpenAPI schema; every number returned with
its decimal scale; every address checksummed.

## 5. MCP server

Exposes typed tools for LLM agents. Implements the [Model Context Protocol
spec](https://modelcontextprotocol.io/). Runs on a separate port from the
REST API but reads from the same backend.

### 5.1 Tool catalog

```typescript
// Read-only tools (no auth required)
tools.assets.list()                                     → AssetSummary[]   // 4 assets in v1.1+, 2 enabled at v1 launch
tools.market.list()                                     → MarketSummary[]  // one row per (assetId × {supply, borrow})
tools.market.get({asset})                               → MarketDetail
tools.market.history({asset, from, to})                 → RatePoint[]
tools.liquidations.scan({minProfitUSD, collateralAsset, debtAsset})
                                                        → LiquidationCandidate[]
tools.oracle.price({asset})                             → PriceQuote
tools.oracle.allPrices()                                → Record<assetSymbol, PriceQuote>

// Authenticated tools (require AgentAccount session)
tools.position.list({ownerAddress})                     → PositionSummary[]
tools.position.get({commitmentId})                      → PositionDetail
  // PositionDetail = { collaterals: {asset → amount}, debts: {asset → amount}, healthFactor, triggers }
tools.policy.get({policyId})                            → Policy
tools.policy.getRemainingBudget({asset})                → BudgetRemaining   // per-asset budget remaining

// Action tools — every action is asset-parameterized
tools.action.entry_deposit({asset, amount})             → { intentId }     // external → PrivacyEntry
tools.action.entry_withdraw({asset, amount, recipient}) → { intentId }     // PrivacyEntry → external
tools.action.supply({asset, amount})                    → { intentId }
tools.action.withdrawSupply({asset, amount})            → { intentId }
tools.action.depositCollateral({asset, amount})         → { intentId }
tools.action.withdrawCollateral({asset, amount, minHF}) → { intentId }
tools.action.borrow({asset, amount, minHF})             → { intentId }
tools.action.repay({asset, amount})                     → { intentId }
tools.action.liquidate({commitment, collateralAsset, debtAsset, debtToCover}) → { intentId }
tools.action.consolidateBalance({asset})                → { intentId }

tools.intent.status({intentId})                         → IntentStatus
tools.intent.confirm({intentId})                        → { txHash, blockNumber }
tools.intent.cancel({intentId})                         → void
```

### 5.2 Intent lifecycle

The agent calls `tools.action.borrow({amount: 50000, minHF: 2.0})`. The
MCP server:

1. Looks up the agent's session + policy.
2. Reads the latest market state.
3. Locates the owner's current borrow note (from notes-storage subsystem).
4. Generates the borrow proof using the server-side prover.
5. Submits to Kurier; gets a jobId.
6. Creates an `intentId` in our DB pointing to the jobId.
7. Returns immediately.

The agent polls `tools.intent.status({intentId})`:
- `submitted` → proof at Kurier, waiting for aggregation
- `aggregated` → proof aggregated; userOp ready to submit
- `userop_pending` → submitted to bundler
- `confirmed` → on-chain
- `failed { reason }` → some validation failed

When `aggregated`, the MCP server **automatically** submits the userOp via
the bundler (unless the policy requires owner co-sign, in which case the
agent must call `tools.intent.confirm` after the owner signs).

### 5.3 Streaming events

For long-running agents, the MCP server exposes:

```typescript
tools.events.subscribe({channel: "myPosition", positionId})
   → stream of { type: "PriceUpdate" | "RateChange" | "AtRisk", ... }

tools.events.subscribe({channel: "liquidations", marketSymbol})
   → stream of new liquidation opportunities

tools.events.subscribe({channel: "policy", policyId})
   → stream of policy state changes (e.g., owner revoked)
```

Implemented as MCP's "elicitation"-style server-to-client notifications.

## 6. Performance notes

- The subgraph queries are paginated; most return < 1MB.
- The MCP server holds a warm Postgres + Goldsky connection pool.
- Proof generation is the slow step (3-8s). The MCP server proves in the
  background and the agent polls intent status — never blocks for proof
  generation time.

## 7. Security & privacy

- **No private notes through this API.** Note storage is Subsystem 09's
  problem. The data layer indexes only on-chain state, which is already
  public (commitments, nullifiers, aggregate amounts).
- **API keys for high-volume agents** are per-AgentAccount; revoking the
  session also revokes the API key.
- **Rate limits per IP and per session** to prevent abuse.
- **MCP transport: HTTPS with mTLS recommended for agents in production.**
  Public mainnet open access uses standard TLS.
- **No PII collection.** The only identifier we tie API usage to is the
  AgentAccount address, which is itself pseudonymous.

## 8. Agent accessibility notes

This is the **agent-first surface**. Every design choice here favours
machine consumption:
- **Typed, schema-validated tools** instead of free-form strings.
- **OpenAPI for the REST.**
- **MCP for LLMs.**
- **Idempotency keys on every action tool** (`intentId`).
- **Streaming subscriptions** for long-running agents.
- **Structured errors** with `code`, `message`, `retryable`, `details`.

A human can call this API too, but they more likely use Subsystem 07
(the dapp), which talks to the same backend.

## 9. Dependencies

- Goldsky for subgraph hosting.
- A REST framework (FastAPI / NestJS / equivalent).
- An MCP server implementation (e.g., `@modelcontextprotocol/sdk`).
- Postgres for intent tracking (shared with Subsystem 04).
- Redis for rate limiting + event-stream fan-out.
- ERC-4337 bundler URL for userOp submissions.
- Server-side Noir prover (Subsystem 02's WASM).

## 10. Diagram

```mermaid
graph TB
  AGENT[LLM agent]
  HUMAN[Human via dapp<br/>subsystem 07]
  EXT[3rd-party integrator]

  subgraph Data Layer
    MCP[MCP server<br/>typed tools]
    REST[REST API<br/>/v1/*]
    BACK[Backend service<br/>Postgres + Redis + Prover + Bundler client]
  end

  GS[Goldsky subgraph<br/>GraphQL]
  KUR[Kurier]
  BUN[ERC-4337 bundler]

  AGENT -- MCP/HTTP --> MCP
  HUMAN -- HTTPS --> REST
  EXT -- HTTPS / API key --> REST

  MCP --> BACK
  REST --> BACK

  BACK -- read --> GS
  BACK -- submit proofs --> KUR
  BACK -- submit userOps --> BUN
  BACK -- server-side proving (Noir + bb.js) --> BACK

  GS <-- indexes events --< CHAIN[Horizen contracts]
```
