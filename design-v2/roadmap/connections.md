# Connections — how subsystems wire together

A map of who-calls-whom across the 17 subsystems. The coding agent
reads this whenever a change touches more than one subsystem, to make
sure the interaction stays on the approved interface.

Authoritative source for any individual subsystem is its own
`../subsystems/NN_*.md`. This file shows only the **edges** between
subsystems — what data crosses, in which direction, and which rules
govern the crossing.

## 1. Top-level graph

```
                            ┌────────────────────────┐
                            │  S07 Human Frontend    │
                            │  (Next.js dapp)        │
                            └─────────┬──────────────┘
                                      │
                            ┌─────────┴──────────────┐
                            │  S08 Agent Runtime     │
                            │  (TS + Py SDKs, MCP)   │
                            └─────────┬──────────────┘
                                      │ both speak
                            ┌─────────┴──────────────┐
                            │  S13 API Contract      │
                            │  (OpenAPI 3.1 + MCP)   │
                            └─────────┬──────────────┘
                                      │ implemented by
                            ┌─────────┴──────────────┐
                            │  S06 Data Layer        │
                            │  (REST + MCP + PG +    │
                            │   Goldsky subgraph)    │
                            └──┬──────────────────┬──┘
                               │                  │
              ┌────────────────┘                  └───────────────┐
              │                                                   │
   ┌──────────┴───────────┐                          ┌────────────┴─────────┐
   │  S05 Oracle + Keepers│                          │  S04 Attestation     │
   │  (Stork + cron       │                          │  Pipeline (Kurier →  │
   │   keepers)           │                          │   zkVerify → Horizen)│
   └──────────┬───────────┘                          └────────────┬─────────┘
              │                                                   │
              │              ┌──────────────────────┐             │
              └─────────────►│  S01 Shielded Pools  │◄────────────┘
                             │  + S03 AgentAccount  │
                             │  + S12 PrivacyEntry  │
                             │  + S10 Governance    │
                             │  (Horizen contracts) │
                             └──────────┬───────────┘
                                        │ verifies
                             ┌──────────┴───────────┐
                             │  S02 ZK Circuits     │
                             │  (Noir + bb)         │
                             └──────────┬───────────┘
                                        │ artifacts via
                             ┌──────────┴───────────┐
                             │  S11 Artifact        │
                             │  Distribution        │
                             │  (Pinata + Filebase) │
                             └──────────────────────┘

  Cross-cutting (not in the flow above but enforced everywhere):
   • S09 Note Management — client-side; touched by S07 and S08
   • S14 Interest & APYs — math used by S01, surfaced by S06/S07/S08
   • S15 Threat Model     — mitigations distributed across all subsystems
   • S16 Performance      — SLOs measured by S06 + S05 + S07
   • S17 Device Support   — server-assisted proving used by S07 (low-tier)
```

## 2. Per-edge interface summary

For each edge below: **producer → consumer**, payload shape, transport,
boundary rule from `architecture_context.md` §3.

### 2.1 Human or Agent → API surface

| Edge | Payload | Transport | Boundary rule |
|---|---|---|---|
| S07 → S13 | REST request (zod-validated intent) | HTTPS + bearer (SIWE) | "Client → backend: yes" (§3.2) |
| S08 → S13 | MCP tool call (typed intent) | MCP over stdio or HTTPS | Same |
| S08 → S13 | REST request (same as S07) | HTTPS + bearer (SIWE-equivalent) | Same |

The API surface (S13) is the **only** way client code reaches the
backend (S06). No backdoors.

### 2.2 API surface → backend services

| Edge | Payload | Transport | Boundary rule |
|---|---|---|---|
| S13 → S06 api-server | controller invocation (in-process) | direct call | n/a |
| S06 api-server → S06 prover-service | "please prove for this witness" | HTTP+JWT internal | "Backend → user secrets: witness OK, key NOT" |
| S06 api-server → S04 relayer | "please submit this proof to Kurier" | message queue (Redis) | "Backend → external services" (§3.2) |
| S06 api-server → Postgres | parameterised SQL | TCP | Standard DB access |
| S06 api-server → Redis | cache + idempotency | TCP | Standard cache access |
| S06 api-server → Goldsky subgraph | GraphQL read | HTTPS | Read-only |

### 2.3 Backend → external services (allowlist)

| Edge | Payload | Boundary rule |
|---|---|---|
| S04 → Kurier | proof submission JSON | "Backend → external" (§3.2) — Kurier approved in §1.6 |
| S04 → zkVerify Volta RPC | aggregation polling | Same — zkVerify approved |
| S05 → Stork RPC | price pull | Same — Stork approved |
| S06 → Goldsky | subgraph deploy + query | Same — Goldsky approved |
| S09 → Pinata + Filebase | optional IPFS pin | Same — both approved |
| S06 → AWS KMS | sign with keeper EOAs | Same — AWS approved |

**No other outbound network destination is allowed.** Per
`agent_workflow_rules.md` Rule 3, introducing one requires `🔌 EXTERNAL
SERVICE NEEDED`.

### 2.4 Cross-chain (S04 attestation pipeline)

```
   S02 (Noir proof) ──► S06 prover-service ──► Kurier REST
                                                  │
                                                  ▼
                                            zkVerify chain (Volta or mainnet)
                                                  │
                                            aggregation finalised
                                                  │
                                                  ▼
                                       S04 relayer keeper
                                                  │
                                                  ▼
                                  Horizen ZkVerifier.verify(...)
                                                  │
                                       (domainId, aggregationId, leafIndex)
                                       consumption recorded; tx executes
```

Boundary: **the proof is the only thing that crosses**. No witness, no
spending key, no plaintext amount. Verified by I-CRYPTO-1 + I-PRIV-1.

### 2.5 On-chain (S01 + S03 + S12 contracts)

```
   user (or AgentAccount)
        │
        ▼  EVM tx via Horizen RPC
   ShieldedSupplyPool / ShieldedPositionPool / LiquidationBoard
        │
        ├──► ZkVerifier.verify(...)  ← S02 vkHash pinned
        │
        ├──► PrivacyEntry.* (POOL_ROLE)  ← S12 custody
        │
        ├──► RateModel.accrue(assetId)   ← S14 math
        │
        ├──► Oracle.getPrice(assetId)    ← S05 (Stork)
        │
        └──► InsuranceFund.cover(...)    ← S01 reserve
```

Boundaries enforced in code:
- Only POOL_ROLE-bearing contracts can move tokens in PrivacyEntry.
- Only ADMIN_ROLE (Safe) can enable a new asset in AssetRegistry.
- Only GUARDIAN_ROLE (hardware wallet) can pause.
- Only KMS-backed keeper EOAs hold MANAGER_ROLE.

### 2.6 ZK circuits → contracts

```
   S02 circuit  ──compile──►  Verifier.sol (per circuit)
                                    │
                              vkHash (sha256 of vk)
                                    │
                                    ▼
                       ZkVerifier constructor:  vkHash[circuitId] = X
                                    │
                                    ▼
                       pool.borrow(proof, publicInputs, vkHash)
                                    │
                       ZkVerifier.verify checks vkHash matches
```

Boundary: **identical leaf-computation recipes** between circuit and
contract (per §3.1 + I-CRYPTO-5). If the circuit changes, the
contract's `vkHash` must change with it.

### 2.7 Note management (S09) — client-only

```
   user wallet signature
        │
        ▼  HKDF
   spending_key (in memory only, never persisted)
        │
        ▼
   IndexedDB encrypted blob (key never leaves memory)
        │
        └──► optional Pinata + Filebase pin (encrypted blob only)
```

Boundary: **the spending key never leaves the browser**. Per I-CRYPTO-1.
Backend never sees it. Even server-assisted proving (S17) only receives
a one-operation witness, never the spending key.

## 3. Cross-subsystem invariants

These invariants depend on multiple subsystems behaving consistently.
Each is owned by a primary subsystem but **enforced across the edges
listed**.

| Invariant | Primary owner | Edges that enforce |
|---|---|---|
| I-CRYPTO-1 (spending key never leaves browser) | S09 | S07 derivation, S06 prover refusing key, S04 logs sanitisation |
| I-CRYPTO-5 (vkHash pinned per circuit) | S02 | S01 ZkVerifier constructor, S11 artifact hash verification |
| I-SOLV-1 (custody ≥ supply × index − deficit) | S01 | PrivacyEntry custody, ShieldedSupplyPool index, InsuranceFund |
| I-AC-4 (POOL_ROLE = pool contracts only) | S01 | S10 governance grants, S12 PrivacyEntry checks |
| I-REPLAY-1 (nullifier once per chain) | S01 | S01 nullifier set, S02 circuit constraint |
| I-REPLAY-4 (aggregation tuple consumed once) | S04 | S04 relayer + S01 ZkVerifier |
| I-PRIV-3 (auditor only on opt-in) | S12 | S12 entry note, S10 AuditorRegistry |
| I-OPS-2 (deployed bytecode = artifact hash) | S11 | S11 ProtocolArtifactRegistry + CI |

## 4. Anti-patterns the agent must reject

If the code ever wants to do any of these, that's an automatic
`🔔 DECISION NEEDED` per `agent_workflow_rules.md` Rule 9.

- Subgraph (S06) initiating a state-changing call.
- API server (S06) signing on a user's behalf.
- Keeper (S05) holding ADMIN_ROLE.
- AgentAccount (S03) bypassing PolicyRegistry validation.
- Prover service (S06/S17) persisting a witness past the prove call.
- PrivacyEntry (S12) moving tokens at an EOA's request.
- Dapp (S07) sending the spending key over the wire.
- Any contract using `tx.origin` or `delegatecall(userInput)`.

## 5. Per-subsystem outgoing edges (quick lookup)

| Subsystem | Speaks to | Speaks via |
|---|---|---|
| **S01** Shielded Pools | S02, S05, S12, S14, S04 | EVM internal calls |
| **S02** Circuits | S01 (via Verifier.sol) | compile-time artifacts |
| **S03** Smart Accounts | S01 (bundler → entrypoint → AgentAccount → pool) | ERC-4337 v0.7 |
| **S04** Attestation | S02 (input), S01 (output), Kurier (external) | REST + EVM |
| **S05** Oracle / Keepers | S01 (writes prices, calls accrue), Stork (external) | EVM + REST |
| **S06** Data Layer | S07, S08 (incoming); S01, S02, S04 (outgoing); Postgres, Redis, Goldsky | HTTPS + MCP + GraphQL + SQL |
| **S07** Frontend | S06 (REST/MCP), S01 (direct EVM read), wallets | HTTPS + EVM |
| **S08** Agent SDKs | S06 (REST/MCP) | HTTPS + MCP |
| **S09** Notes | S07 (in-browser), Pinata + Filebase (optional) | IndexedDB + HTTPS |
| **S10** Governance | S01 (admin role holder), AuditorRegistry, Safe | Safe tx |
| **S11** Artifacts | S01 (ProtocolArtifactRegistry), Pinata + Filebase | IPFS + EVM |
| **S12** PrivacyEntry | S01 pools (via POOL_ROLE), S02 entry circuits | EVM internal |
| **S13** API Contract | S07, S08 ↔ S06 | OpenAPI + MCP catalogs |
| **S14** Interest | math used by S01; surfaced by S06/S07/S08 | pure math |
| **S15** Threat Model | mitigations distributed; no direct edges | docs + tests |
| **S16** Performance | observed at S06/S05/S07 | metrics |
| **S17** Device Support | S07 (UI), S06 prover-service (server-assisted path) | HTTPS |

## 6. Sequence diagrams (key flows)

### 6.1 Human supply flow

```
User --signs SIWE--> S07
S07 --derives--> spending_key (in memory)
S07 --REST POST /intents/supply--> S06 (api-server)
S06 --validates with zod--> idempotency check (Postgres)
S06 --returns jobId--> S07
S07 --builds witness, runs Noir prover (browser or worker)--> proof
S07 --REST POST /jobs/{jobId}/proof--> S06
S06 --enqueues--> S04 (relayer)
S04 --POST--> Kurier
Kurier --aggregates on zkVerify--> aggregation finalised
S04 --listens, picks up tuple--> Horizen ZkVerifier.verify(...)
S01 ShieldedSupplyPool --emits SupplyExecuted--> Goldsky subgraph
S06 --polls subgraph for finalisation--> updates job status
S07 --polls /jobs/{jobId}--> "finalised"
S07 --shows updated balance from local notes (S09)--> user
```

### 6.2 Agent borrow flow

```
Owner --signs Policy off-chain--> S08
S08 --POST /policies--> S06
S06 --calls PolicyRegistry.registerPolicy(...)--> S01
Owner --hands session key--> agent process
Agent --MCP tools/list--> S06 (returns catalog from S13)
Agent --MCP call submitBorrow(intent)--> S06
S06 --builds userOp, signs with session key (no, agent signs)--> bundler
bundler --EntryPoint.handleOps--> AgentAccount (S03)
AgentAccount --validateUserOp checks PolicyRegistry--> ok or revert
AgentAccount --executes borrow on ShieldedPositionPool--> S01
... rest of flow same as 6.1 from S04 onwards
```

### 6.3 Liquidation flow

```
Keeper or anyone --reads LiquidationBoard via subgraph--> S06
S06 --returns positions where currentPrice < trigger--> caller
Caller --POST /intents/liquidate (target, collateralAsset, debtAsset)--> S06
... proof + aggregation ...
S01 LiquidationBoard.liquidate(...) --executes--> close-factor logic
LiquidationBoard --moves seized collateral via PrivacyEntry--> caller's entry note
LiquidationBoard --bonus 5% to liquidator, 3% to InsuranceFund-->
S01 --emits LiquidationCalled--> Goldsky
```

## 7. Forbidden cross-edges (re-emphasised)

For convenience, the agent's mental list of "this edge MUST NOT exist
in the codebase":

1. `dapp → spending_key_storage_backend` — no such backend exists.
2. `subgraph → contract.write` — subgraph is read-only.
3. `agent_account.execute → arbitrary contract not in allowlist` — policy restricts targets.
4. `keeper_eoa → admin_role_call` — keepers have only MANAGER_ROLE.
5. `prover_service → persistent_witness_storage` — witnesses are RAM-only.
6. `dapp → console.log(witness)` — no logging of secrets per S/cs §7.
7. `api_server → spending_key` — backend never receives one.

If a PR introduces any of these, the agent must flag `🔔 DECISION
NEEDED` and explain why the boundary is at risk.

## 8. Cross-references

- Per-subsystem details: [`../subsystems/`](../subsystems/)
- Boundary rules + invariants: [`architecture_context.md`](architecture_context.md)
- Threat model with mitigations: [`../subsystems/15_threat_model.md`](../subsystems/15_threat_model.md)
- Composition diagrams: [`../integration.md`](../integration.md)
