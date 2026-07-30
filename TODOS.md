# TODOS.md — deferred scope (explicitly NOT in M1–M4)

Everything here was consciously deferred, not forgotten. Source: resume plan §NOT-in-scope.

## Post-validation (needs Gate 2 pass or whale traction)
- Liquidator + auditor UI (old Day 15 scope)
- IPFS/Pinata encrypted note backup (additive to ADR-002 memo recovery; nice-to-have export path)
- SDK hardening (sdk-ts / sdk-py are untested scaffolds)

## Pre-audit prep (before Gate 3 / mainnet)
- CI pipeline + reproducible builds + artifact registry (old Day 19)
- S03 execution-phase policy implementation in AgentAccount (ADR-001 decided; lands with agent-runtime milestone)
- Delete dead `_seedDeposits` in EmitTestEvents.s.sol if not done in the Day 14c-F commit

## Mainnet prep (after Gate 3)
- KMS signing (old mainnet prep)
- Server-assisted proving for low-end devices (old Day 20)
- Governance / Safe migration (old Day 18)

## Protocol observability gap (found during M2.5)
- `spendBalance` inserts the residual commitment but never events its value
  (only `MerkleRootUpdated` fires) — residual leaves can't be index-joined from
  logs. Deposit-memo recovery doesn't need it, but full spend-flow recovery
  will. Additive fix candidate: include the residual commitment in the
  `BalanceSpent` event (new event version, subgraph handler addition).

## Doc debt (fix critical-path only per D3=B)
- REWRITE: `design-v2/roadmap/code_roadmap.md` (retired — MILESTONES.md replaces), `design-v2/subsystems/06_data_layer.md`
- UPDATE: remaining design-v2 files for Horizen 2.0 ground truth (chainId 845320009, no "Tachyon chain", no Goldsky) — batch, low priority
- Stale comment: `code/circuits/entry_withdraw/src/main.nr:14` says "pedersen_hash", hash is Poseidon2
- `code/dapp/src/lib/chains.ts` header comment cites dead 2651420 / architecture_context §1.1 — fixed by M1.4 chain-config

## Monthly recurring
- Re-check Horizen chain health vs Gate 1 (explorer.horizen.io `/api/v2/stats` + `/stats/api/v1/lines/activeAccounts?resolution=DAY`); if it ever passes, revisit the whale-first vs Horizen-flagship split.
