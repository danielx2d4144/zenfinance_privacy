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

## Chain ground truth (corrects design-v2 everywhere)

- **Horizen 2.0** = EVM-native L3 on **Base**, mainnet live since Dec 2025, chainId **26514**, explorer https://explorer.horizen.io
- **Horizen testnet**: chainId **845320009**, RPC `https://horizen-rpc-testnet.appchain.base.org`, explorer `https://horizen-explorer-testnet.appchain.base.org`
- **DEAD**: old Caldera testnet chainId **2651420** (still referenced in `design-v2/` and `code/dapp/src/lib/chains.ts` — the latter is fixed by the M1.4 chain-config module)
- **"Tachyon" is an ecosystem APP** (private cross-chain transfers, May 2026), NOT the chain or testnet
- Current deploy targets: **Anvil 31337** (daily dev), **Base Sepolia 84532** (attestation E2E), **Horizen testnet 845320009** (M3, gated on spike)

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
