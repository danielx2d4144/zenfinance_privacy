# GROUND_TRUTH.md — canonical state of ZenFinance

Last verified: 2026-07-30. This file supersedes any conflicting claim in `design-v2/`
(notably `roadmap/progress_tracker.md`, which stops at Day 11 while git reaches Day 14c-E).
**Git history is the source of truth for what is built; this file is the map.**

## What is built (verified, not aspirational)

| Layer | Status | Evidence |
|---|---|---|
| Contracts (11): PrivacyEntry, ShieldedSupplyPool, ShieldedPositionPool, LiquidationBoard, AgentAccount, PolicyRegistry, AssetRegistry, Oracle, RateModel, InsuranceFund, ZkVerifier | BUILT | `forge test` 217/217 PASS (re-run 2026-07-30) |
| Noir circuits (11): entry_deposit, entry_withdraw, supply_asset, withdraw_supply, deposit_collateral, withdraw_collateral, borrow, repay, liquidate, consolidate_balance, compute_triggers (+ lib_common) | BUILT | Poseidon2/BN254; vkHashes pinned Day 14c (`design-v2/roadmap/progress_tracker.md` registry) |
| Browser proving | BUILT | bb.js web-worker prover + adaptive tiering (Day 14) |
| Attestation E2E | BUILT on **Base Sepolia** | entry proof → Kurier → aggregation → `verifyAndConsume` (Day 8, T-8.1). **zkVerify proxy has NEVER been verified on Horizen testnet** — that is the M3 spike's job. |
| Data stack | BUILT (local only) | docker graph-node subgraph — **local docker only, never Goldsky** |
| Backend | BUILT | data-api (Fastify 5 REST + MCP), price-keeper (Stork), prover-service scaffold |
| Dapp | BUILT (demo-grade) | Next.js; deposit/borrow loop works on Anvil; IMT mirror; real Poseidon2 witness |
| Note store | **IN-MEMORY ONLY** | Funds "disappear" from UI on refresh (chain-safe, UX-broken). Fix = M2. |
| SDKs | SCAFFOLD | sdk-ts, sdk-py — untested against live stack |

## Chain ground truth (re-verified live 2026-08-03 — supersedes the 07-30 entry)

- **Horizen mainnet**: chainId **26514**. Explorers https://explorer.horizen.io and
  https://horizen.calderaexplorer.xyz serve the **same chain** (identical `/api/v2/stats`
  payloads), so the Gate-1 health numbers below were measured on the correct chain.
- **Horizen testnet**: chainId **2651420**, RPC `https://horizen-testnet.rpc.caldera.xyz`,
  explorer `https://horizen-testnet.explorer.caldera.xyz`, hub/faucet
  `https://horizen-testnet.hub.caldera.xyz`. **LIVE**: 24.1M+ blocks, ~1 block/sec
  measured, gas ~0.001 gwei.
- **CORRECTION:** the 2026-07-30 revision of this file claimed 2651420 was dead and
  845320009 was the live testnet. That was **backwards**. `horizen-rpc-testnet.appchain.base.org`
  and `horizen-explorer-testnet.appchain.base.org` have **no DNS A record** (checked via
  8.8.8.8 and 1.1.1.1), while 2651420 answers and is the chain **zkVerify officially
  supports**. Source of the error: a search result treated as authoritative without an
  RPC probe. Rule: never record a chain endpoint without an `eth_chainId` call.
- **zkVerify aggregation proxies** (zkVerify "Supported Networks" table, verified on-chain):
  - Horizen testnet 2651420 → `0x3098A6974649478f0133046e44105AA84e868C21`
    (ERC-1967 proxy; implementation slot → `0x03225ff1ff4f1bac6e81bb6317006a509422d51c`)
  - Horizen mainnet 26514 → `0xCb47A3C3B9Eb2E549a3F2EA4729De28CafbB2b69`
  - Base Sepolia 84532 → `0x0807C544D38aE7729f8798388d89Be6502A1e8A8`
    — **matches this repo's working T-8.1 config exactly**, which cross-validates the table.
- **Canonical ERC-4337 EntryPoints on Horizen testnet**: v0.7
  `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (~16KB bytecode) AND v0.6 both deployed.
- **"Tachyon" is an ecosystem APP** (private cross-chain transfers, May 2026), NOT the chain.
- Deploy targets: **Anvil 31337** (dev), **Base Sepolia 84532** (attestation E2E),
  **Horizen testnet 2651420** (M3).

## M3 spike result (run 2026-08-03) — 3 of 4 gates PASS

| Gate | Result | Evidence |
|---|---|---|
| 1. RPC + faucet usable | **PASS** | RPC live, 24,142,208 blocks, 21 blocks/20s, gas 0.001 gwei; hub/faucet HTTP 200 |
| 2. Canonical EntryPoint present | **PASS** | v0.7 and v0.6 both have bytecode on-chain |
| 3. zkVerify proxy on Horizen testnet | **PASS** | ERC-1967 proxy with non-zero implementation (addresses above) |
| 4. Deploy script clean | **OPEN** | Requires an actual deploy run — the remaining M3 work |

Consequence: the Base-Sepolia-fallback branch is **not needed**. The demo can ship on
Horizen testnet, which is what the founder publicly committed to (August beta).

## Aggregation path proven on Horizen testnet (2026-08-03) — M3 Phase-0 gate PASS

A real `entry_deposit` UltraHonk proof was submitted to Kurier with `chainId=2651420`,
aggregated by zkVerify, published to the Horizen proxy, and verified on-chain. Reproduce
with `npm run probe:horizen` in `code/backend/prover-service`.

| Kurier status | Elapsed | Δ |
|---|---|---|
| Submitted | 2s | 2s |
| IncludedInBlock | 7s | 6s |
| AggregationPending | 25s | 17s |
| **Aggregated** | **2m 54s** | 2m 29s |

- Job `2d1e0210-8f37-11f1-a611-d6f56b47605a`, aggregation **1185**, leaf **4 of 5**,
  root `0x7d7bc6b7…ee773`, merkle path depth 1.
- `AggregationPosted` landed in tx
  [`0xc0c5c9f4…97029`](https://horizen-testnet.explorer.caldera.xyz/tx/0xc0c5c9f47c3ebb81066d39f8d0034c39ea5ab68211f5afa22806e3cfb7297029)
  at block **24,171,240**.
- `verifyProofAggregation(175, 1185, leaf, path, 5, 4)` on
  `0x3098A6974649478f0133046e44105AA84e868C21` returns **true**.

**Domain 175 is Horizen testnet's on-chain aggregation domain.** This corrects the comment
in `code/backend/prover-service/.env`, which claimed 175 was "a Kurier-internal queue id,
NOT the on-chain proxy domain". Domains are logical aggregation containers, one set per
destination chain: Base Sepolia = 2, Horizen testnet = 175. Both are real on-chain domains.

**The domain is not idle.** An earlier `eth_getLogs` scan over the last 200k blocks found
nothing and suggested the last publication was 2026-07-14; the scan window was simply too
narrow. Our proof landed as leaf 4 of a 5-leaf batch, i.e. other traffic shared it.

Consequence: ~3 minutes is the **measured UX budget** for any proof-backed action, and the
guided borrow (three sequential proofs) is ~9 minutes — long enough that it must run as a
background job with notification, not a blocking modal.

## Strategy state (from approved design doc, 2026-07-30)

- **Gate 1 (Horizen chain health: ≥$5M TVL AND ≥100 daily actives): FAILED** — measured ~20 avg daily actives (peak 69), 7,047 lifetime addresses, no measurable TVL (explorer.horizen.io Blockscout API).
- Consequence honored: **whale-first (Approach C) is the active mainnet strategy**. Horizen = funding/optionality channel only (Thrive grant + testnet demo). Re-check chain health monthly.
- Gate 2: ≥2/5 Mom-Test calls surface concrete past pain → consumer wedge lives. Pending (M4).
- Gate 3: audit funding secured before ANY mainnet deploy ($230k–$410k range). Pending.

## Decisions of record

- `docs/adr/ADR-001` — ERC-4337 policy enforcement in execution phase (validateUserOp = sig/session only)
- `docs/adr/ADR-002` — notes use per-note RANDOM salt + encrypted memo in deposit event; recovery by viewing-key trial-decryption. Supersedes S09 leaf-index salts AND interim counter salts. **Circuits unaffected (verified: all 11 take salt as unconstrained private input — no vkHash re-pin).**
- Key derivation: one EIP-712 signature → HKDF(low-s r||s) → spendingKey / viewingKey / storageKey. EOA-only (sign-twice determinism check).
- Plan of record: `MILESTONES.md` (M1–M4). The 21-day day-locked roadmap in design-v2 is RETIRED.

## Known stale docs (do not trust without checking here first)

- `design-v2/roadmap/progress_tracker.md` — frozen at Day 11; vkHash registry + decisions log still valid
- `design-v2/roadmap/code_roadmap.md`, `design-v2/subsystems/06_data_layer.md` — verdict REWRITE
- `design-v2/subsystems/09_note_management.md` — superseded by ADR-002
- `design-v2/subsystems/03_smart_accounts_policies.md` §validateUserOp — superseded by ADR-001
- Any mention of chainId 2651420, Goldsky, or "Tachyon testnet" — dead/wrong
