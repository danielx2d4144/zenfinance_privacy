# Subsystem Tests — per-day test protocols

What the coding agent runs after finishing each day's deliverables.
The agent **MUST** execute the day's section here before declaring the
day complete (per `agent_workflow_rules.md` Rule 5).

## How to read each test block

Each test:
- **ID** — referenced from `progress_tracker.md`.
- **Setup** — preconditions, fixtures, environment.
- **Steps** — exact commands or actions.
- **Observe** — what the agent watches for.
- **Pass criteria** — what counts as success.
- **On failure** — diagnostic next step (always: investigate, do not skip).

Tests run in the order listed. Run all tests in the day's section
before moving to the next day.

---

## Day-1 — AssetRegistry + RateModel + Oracle

### T-1.1 AssetRegistry: enable/disable asset with correct role

- **Setup**: deploy AssetRegistry; grant `MANAGER_ROLE` to a test address.
- **Steps**: from MANAGER, call `enableAsset(0, USDCConfig)`. From a non-manager, call `enableAsset(1, cbBTCConfig)`.
- **Observe**: first tx succeeds and emits `AssetEnabled(0)`. Second tx reverts with `AccessControlUnauthorizedAccount`.
- **Pass**: both observations hold.
- **On fail**: check role wiring; never weaken the role check.

### T-1.2 RateModel: rate is monotone in utilization below kink

- **Setup**: instantiate RateModel with USDC parameters (per S14 §4 table).
- **Steps**: compute `borrowRatePerSecond(util)` for util ∈ {0%, 10%, 50%, kink−1%}.
- **Observe**: result is strictly increasing.
- **Pass**: rates are monotone.
- **On fail**: re-derive math against S14 §3 piecewise function.

### T-1.3 RateModel: rate slope steepens above kink

- **Setup**: same.
- **Steps**: compute rates at util ∈ {kink, kink+1%, 100%}.
- **Observe**: slope above kink > slope below kink.
- **Pass**: per S14 §3 the second-segment slope is larger.
- **On fail**: check `slope2` parameter; recompare to S14 §4 table.

### T-1.4 Oracle: rejects stale price

- **Setup**: Oracle with staleness window 60s; set price at `t0`.
- **Steps**: `vm.warp(t0 + 61); oracle.getPrice(0)`.
- **Observe**: revert with `PriceStale(...)`.
- **Pass**: revert occurs.
- **On fail**: verify staleness check is on read, not on write.

### T-1.5 Coverage gate

- **Steps**: `forge coverage --report summary`.
- **Observe**: line coverage ≥ 95% on each of `AssetRegistry.sol`, `RateModel.sol`, `Oracle.sol`.
- **Pass**: gate met.
- **On fail**: add tests for the uncovered branches before continuing.

---

## Day-2 — PrivacyEntry + InsuranceFund + ZkVerifier

### T-2.1 PrivacyEntry: only POOL_ROLE moves tokens

- **Setup**: deploy PrivacyEntry; grant POOL_ROLE to a mock pool.
- **Steps**: from the pool, call `withdrawFromCustody(...)`. From an EOA, call the same.
- **Observe**: pool succeeds; EOA reverts with `AccessControlUnauthorizedAccount`.
- **Pass**: both hold.

### T-2.2 PrivacyEntry: appCustody arithmetic exact

- **Setup**: deposit 1000 USDC; withdraw 250; deposit 500.
- **Observe**: `appCustody[USDC]` == 1250; ERC-20 balanceOf(privacyEntry) == 1250.
- **Pass**: equal.

### T-2.3 ZkVerifier: rejects vkHash mismatch

- **Setup**: deploy ZkVerifier with vkHash[0] = H1.
- **Steps**: call `verify(0, proof, publicInputs, H2)` where H2 ≠ H1.
- **Observe**: revert with `InvalidVkHash(...)`.
- **Pass**: revert occurs.

### T-2.4 ZkVerifier: rejects double-consumption

- **Setup**: consume `(1, 42, 0)` once.
- **Steps**: try to consume the same tuple again.
- **Observe**: revert with `AggregationAlreadyConsumed(...)`.
- **Pass**: revert occurs.

### T-2.5 InsuranceFund: only callable by pool

- **Setup**: grant POOL_ROLE to one pool; deploy IF.
- **Steps**: pool calls `cover(100, 0)`. EOA calls `cover(100, 0)`.
- **Observe**: pool succeeds; EOA reverts.
- **Pass**: both hold.

---

## Day-3 — ShieldedSupplyPool + ShieldedPositionPool + LiquidationBoard

### T-3.1 ShieldedSupplyPool: supply increases custody and supplyIndex updates

- **Setup**: AssetRegistry, RateModel, Oracle, PrivacyEntry, ZkVerifier deployed and wired.
- **Steps**: build a happy-path supply proof (mock proof for now if Day-4 circuits not yet integrated); call `supply(...)`.
- **Observe**: custody balance ↑; supplyIndex called once.
- **Pass**: both hold; relevant events emitted.

### T-3.2 ShieldedPositionPool: borrow with HF<1 reverts

- **Setup**: position with collateral worth $100; try to borrow $80 USDC at LTV 65% (max $65).
- **Observe**: revert with `HealthFactorBelowOne(...)`.
- **Pass**: revert occurs.

### T-3.3 LiquidationBoard: close factor 50% / 100% boundary at HF=0.95

- **Setup**: positions at HF = 0.96 and HF = 0.94.
- **Steps**: liquidate both for max amount.
- **Observe**: 0.96 capped at 50% of debt; 0.94 allows 100%.
- **Pass**: per S01 §3 close-factor rules.

### T-3.4 LiquidationBoard: 8% bonus split 5/3

- **Setup**: liquidate $100 of debt at 8% bonus.
- **Observe**: liquidator gets $5 worth of collateral; InsuranceFund gets $3.
- **Pass**: amounts match.

### T-3.5 Invariant test: I-SOLV-1 holds across multi-call fuzz

- **Steps**: `forge test --match-contract Invariant_Solv --fuzz-runs 10000`.
- **Observe**: no run finds a state where `appCustody[token] < sum(active supply × index) − deficit`.
- **Pass**: 0 failing runs.

---

## Day-4 — Noir circuits part 1

### T-4.1 entry_deposit: valid witness verifies

- **Setup**: known fixture in `Prover.toml`.
- **Steps**: `nargo execute && bb prove && bb verify`.
- **Observe**: `bb verify` returns "Proof verified successfully".
- **Pass**: verification succeeds.

### T-4.2 entry_deposit: tampered public input fails

- **Steps**: edit publicInputs after proving; `bb verify`.
- **Observe**: verification fails.
- **Pass**: failure.

### T-4.3 supply_asset: walks all slots

- **Setup**: position with 4 asset slots populated.
- **Steps**: prove a supply; inspect the recomputed indices.
- **Observe**: all 4 slot indices refreshed.
- **Pass**: all 4 reflect post-accrue values.

### T-4.4 Differential fuzz (per-circuit)

- **Steps**: run the custom Node harness with 100 random valid witnesses.
- **Observe**: 100/100 verify.
- **Pass**: 100%.

### T-4.5 Adversarial fuzz (per-circuit)

- **Steps**: run with 100 random invalid witnesses.
- **Observe**: 0/100 verify.
- **Pass**: 0%.

---

## Day-5 — Noir circuits part 2

### T-5.1 borrow: HF check enforced in-circuit

- **Setup**: witness with post-op HF = 0.99.
- **Observe**: prove fails because of in-circuit `assert(hf >= ONE)`.
- **Pass**: prove fails.

### T-5.2 repay: interest accrual correct

- **Setup**: known debt + known interest over Δt; prove repay.
- **Observe**: the public input `debtRepaid` equals `principal + interest`.
- **Pass**: equality holds within 1 wei.

### T-5.3 liquidate: close-factor and bonus encoded

- **Setup**: HF=0.97 case (50% close factor).
- **Observe**: proof of liquidating > 50% of debt fails.
- **Pass**: failure.

### T-5.4 consolidate_balance: N→1 conserves value

- **Setup**: 5 supply notes of varying sizes.
- **Observe**: output note value == sum(input note values).
- **Pass**: equality.

### T-5.5 Adversarial fuzz across all circuits

- **Steps**: combined harness, 1000 invalid witnesses.
- **Observe**: 0/1000 verify.
- **Pass**: 0%.

---

## Day-6 — PrivacyEntry end-to-end

### T-6.1 Full entry → supply → withdraw loop

- **Setup**: Anvil fork of Horizen testnet state; all Day 1-5 contracts deployed; real Noir proofs.
- **Steps**: deposit 1000 USDC → supply 500 → withdraw 500 → exit 1000.
- **Observe**: ERC-20 USDC balance returns to start; custody returns to 0.
- **Pass**: equality.

### T-6.2 Replay nullifier reverts

- **Setup**: as in T-6.1; capture the entry-withdraw nullifier.
- **Steps**: replay the same withdraw tx (or a duplicate).
- **Observe**: revert with `NullifierAlreadySpent(...)`.
- **Pass**: revert.

### T-6.3 Mismatched vkHash reverts

- **Steps**: build a proof from a hand-mutated bytecode (different circuit).
- **Observe**: ZkVerifier reverts.
- **Pass**: revert.

---

## Day-7 — Smart accounts + policies

### T-7.1 AgentAccount: valid userOp accepted

- **Setup**: deploy AgentAccount; register a $500k USDC borrow cap.
- **Steps**: build a borrow userOp for $100k; submit via bundler.
- **Observe**: success.
- **Pass**: borrow executes.

### T-7.2 AgentAccount: over-cap rejected

- **Steps**: same as 7.1 but $600k.
- **Observe**: validateUserOp reverts with `PolicyCapExceeded(...)`.
- **Pass**: revert.

### T-7.3 AgentAccount: HF-floor enforced

- **Setup**: HF floor 2.0; current position would drop to 1.8 post-borrow.
- **Steps**: submit borrow.
- **Observe**: revert.
- **Pass**: revert.

### T-7.4 Session-key revocation is instant

- **Setup**: session key K active.
- **Steps**: owner calls `revokeSession(K)`. Try a userOp signed by K.
- **Observe**: 2nd userOp fails.
- **Pass**: failure within 1 block of revocation.

---

## Day-8 — Attestation pipeline

### T-8.1 Submit → Kurier → zkVerify → Horizen end-to-end (testnet)

- **Setup**: real Kurier creds in env; real Volta + Horizen testnet.
- **Steps**: compile a small proof; submit via prover-service; observe relayer pick up tuple; observe Horizen tx finalised.
- **Observe**: full path completes; recorded `(domainId, aggregationId, leafIndex)` consumed.
- **Pass**: success.

### T-8.2 Kurier rate-limit handled

- **Steps**: submit 100 proofs in parallel.
- **Observe**: prover-service backs off on 429s; eventual consistency.
- **Pass**: all 100 eventually accepted.

### T-8.3 zkVerify "aggregation not yet finalised" handled

- **Steps**: poll immediately after submit (before aggregation).
- **Observe**: prover-service does not error; waits with backoff.
- **Pass**: no error; final state reached.

### T-8.4 Horizen tx reverts handled

- **Setup**: pre-consume a tuple; relayer replays.
- **Observe**: relayer logs the revert; does not crash; surfaces alert.
- **Pass**: graceful failure.

---

## Day-9 — Oracle + Keepers

### T-9.1 Oracle: Stork price flows through

- **Steps**: keeper pushes Stork price; read Oracle.
- **Observe**: latest price matches Stork value within tolerance.
- **Pass**: equality.

### T-9.2 Accrue keeper: cadence honoured

- **Steps**: deploy with cadence 60s; run for 5 minutes.
- **Observe**: `accrue(assetId)` called ~5 times per asset.
- **Pass**: 5±1.

### T-9.3 Keeper: KMS signing only

- **Steps**: read keeper config; grep for hardcoded private keys.
- **Observe**: no private key in code or env (KMS ARN only).
- **Pass**: clean.

### T-9.4 Keeper pause: protocol stays safe

- **Setup**: pause all keepers for 10 minutes.
- **Observe**: no liquidations executed during the window even though prices may have moved.
- **Pass**: safety holds (no spurious liquidations).

---

## Day-10 — Subgraph + Postgres

### T-10.1 Subgraph: events indexed correctly

- **Steps**: emit 100 mixed events on Anvil; deploy subgraph locally; query counts.
- **Observe**: per-entity counts match.
- **Pass**: exact match.

### T-10.2 Subgraph: read-only enforced

- **Steps**: attempt to add a write handler.
- **Observe**: code review fails (mappings don't have a contract-call surface).
- **Pass**: by construction; no write API exists in The Graph mappings.

### T-10.3 Postgres migrations: up + down

- **Steps**: apply all migrations; rollback each in reverse.
- **Observe**: final schema is empty.
- **Pass**: clean rollback.

---

## Day-11 — REST API + MCP server

### T-11.1 REST: submit deposit intent + poll + finalise

- **Steps**: POST `/intents/deposit`; receive `jobId`; poll `/jobs/{jobId}` until finalised.
- **Observe**: status progression pending → submitted → finalised.
- **Pass**: terminal state finalised.

### T-11.2 Idempotency: duplicate key returns existing intent

- **Steps**: POST same intent twice with the same `Idempotency-Key`.
- **Observe**: second response has identical `jobId`.
- **Pass**: equality.

### T-11.3 MCP: tools/list returns full catalog

- **Steps**: MCP `tools/list`.
- **Observe**: each intent kind from S13 appears as a tool with schema.
- **Pass**: complete.

### T-11.4 OpenAPI: spec lints clean

- **Steps**: `spectral lint openapi.json`.
- **Observe**: 0 errors, 0 warnings.
- **Pass**: clean.

---

## Day-12 — SDK stubs + API contract docs

### T-12.1 SDK-TS: end-to-end deposit example

- **Steps**: run `sdk-ts/examples/deposit.ts` against the running API server.
- **Observe**: deposit intent submitted and finalised.
- **Pass**: success.

### T-12.2 SDK-Py: end-to-end deposit example

- **Steps**: run `sdk-py/examples/deposit.py`.
- **Observe**: deposit succeeds.
- **Pass**: success.

### T-12.3 Schemas shared

- **Steps**: compare zod schema in api-server with the generated TS types.
- **Observe**: types are derived from the same source.
- **Pass**: derivation chain intact.

---

## Day-13 — Frontend scaffolding + wallet + entry

### T-13.1 Connect wallet on Horizen testnet

- **Steps**: open dapp; click connect; choose MetaMask.
- **Observe**: chain switched to Horizen testnet; address shown.
- **Pass**: connected.

### T-13.2 Spending key derived but not persisted

- **Steps**: derive key; close tab; reopen.
- **Observe**: key state is gone; user must re-sign.
- **Pass**: no persistence.

### T-13.3 PrivacyEntry deposit reflects in UI

- **Steps**: deposit 100 USDC.
- **Observe**: UI updates from local note store.
- **Pass**: balance visible after finalisation.

---

## Day-14 — Frontend lending flows + browser proving

### T-14.1 Browser prover: off main thread

- **Steps**: trigger a borrow flow; while proving, interact with the UI (scroll, click).
- **Observe**: UI remains responsive; no jank.
- **Pass**: responsive.

### T-14.2 Borrow flow: full happy path

- **Steps**: deposit collateral → borrow USDC at 50% LTV.
- **Observe**: borrowed funds appear; on-chain debt commitment exists.
- **Pass**: success.

### T-14.3 Adaptive prove: low-tier device path

- **Setup**: simulate low-tier via `userAgent` override.
- **Steps**: trigger borrow; observe routing to server-assisted prover.
- **Observe**: prove completes via server; client never produces the proof.
- **Pass**: routing happens; latency within S17 target.

---

## Day-14b — Lending intent handlers (real ZK path)

> Inserted after Day 14 to close the schema-vs-roadmap gap; see the
> Day-14b section in `code_roadmap.md` for context.

### T-14b.1 Supply happy path

- **Steps**: from the dapp's Supply tab, supply 100 USDC against an
  existing PrivacyEntry balance.
- **Observe**: intent transitions
  `received → proving → aggregating → aggregated → userop_pending →
  confirmed`; `ShieldedSupplyPool` emits a `Supplied` event; subgraph
  reflects the new commitment.
- **Pass**: terminal status `confirmed` with a tx hash.

### T-14b.2 Borrow happy path (was T-14.2)

- **Setup**: 1000 USDC in PrivacyEntry, 0.5 cbBTC deposited as collateral.
- **Steps**: borrow 100 USDC from the Borrow tab with minHfBps=15000.
- **Observe**: `ShieldedPositionPool` emits `Borrowed`; the user's
  borrowed funds appear in a new debt note; HF computed locally
  stays ≥ 1.5.
- **Pass**: terminal `confirmed`; debt commitment present.

### T-14b.3 Repay clears debt

- **Setup**: outcome of T-14b.2 (debt note for 100 USDC).
- **Steps**: repay 100 USDC from the Repay tab.
- **Observe**: nullifier consumes the debt note; pool balance back to
  pre-borrow state.
- **Pass**: terminal `confirmed`.

### T-14b.4 Concurrent handler safety

- **Setup**: 3 distinct intents (supply / borrow / repay) submitted in
  parallel from 3 browser tabs.
- **Observe**: each one reaches `confirmed`; no nonce gaps in the
  relayer's tx history; the chain mutex from Day 12 keeps writes
  serialized.
- **Pass**: 3 successes, distinct tx hashes, no failed-via-race.

---

## Day-15 — Liquidator + auditor + i18n + a11y

### T-15.1 Liquidator board: shows underwater positions

- **Setup**: synthesize a position with currentPrice < trigger.
- **Steps**: open `/liquidator`.
- **Observe**: position listed.
- **Pass**: listed.

### T-15.2 Liquidator: 1-click LIQUIDATE submission

- **Steps**: click LIQUIDATE.
- **Observe**: intent submitted; collateral seized in entry note.
- **Pass**: success.

### T-15.3 Auditor mode: only opted-in positions visible

- **Setup**: 5 positions, 2 opted-in.
- **Steps**: open `/auditor`.
- **Observe**: 2 positions; decryption succeeds; opt-out positions absent.
- **Pass**: privacy holds.

### T-15.4 i18n: every visible string in `messages/en.json`

- **Steps**: `grep -R "t('"` and audit raw strings in JSX.
- **Observe**: every visible string is keyed.
- **Pass**: 0 raw strings outside content blocks.

### T-15.5 axe-core: 0 critical/serious

- **Steps**: `pnpm dlx @axe-core/cli http://localhost:3000`.
- **Observe**: 0 critical, 0 serious.
- **Pass**: clean.

---

## Day-16 — Agent runtime + SDKs

### T-16.1 TS agent: full borrow loop

- **Steps**: run `sdk-ts/examples/agent-borrow.ts` with a registered policy.
- **Observe**: borrow succeeds within policy.
- **Pass**: success.

### T-16.2 Py agent: full borrow loop

- **Steps**: run `sdk-py/examples/agent_borrow.py`.
- **Observe**: same.
- **Pass**: success.

### T-16.3 Revocation: agent receives 403

- **Steps**: revoke session; agent submits another intent.
- **Observe**: 403 returned; no on-chain tx.
- **Pass**: enforced at API layer.

---

## Day-17 — Note management

### T-17.1 Notes persist across browser sessions

- **Steps**: deposit + supply; close browser; reopen.
- **Observe**: notes loaded from IndexedDB.
- **Pass**: visible after reload.

### T-17.2 Recovery from wallet signature only

- **Steps**: wipe IndexedDB; re-sign wallet; re-scan chain.
- **Observe**: notes rebuilt from on-chain commitments.
- **Pass**: full state recovered.

### T-17.3 Compaction: 5 notes → 1

- **Steps**: trigger consolidate.
- **Observe**: post-state has 1 note with total value.
- **Pass**: equal value, 1 note.

### T-17.4 Optional IPFS backup

- **Steps**: opt in; back up; clear local; restore from IPFS.
- **Observe**: restore succeeds with same notes.
- **Pass**: round-trip.

---

## Day-18 — Governance + Safe + AuditorRegistry

### T-18.1 No EOA has ADMIN_ROLE

- **Steps**: per contract, `hasRole(ADMIN_ROLE, eoa)` for all known deployer EOAs.
- **Observe**: all false; Safe is the only ADMIN_ROLE holder.
- **Pass**: invariant holds.

### T-18.2 Safe-driven asset enable end-to-end

- **Steps**: from Safe UI, propose + sign + execute `enableAsset(...)`.
- **Observe**: tx executes; AssetEnabled event emitted.
- **Pass**: success.

### T-18.3 Guardian pause

- **Steps**: from hardware-wallet-backed guardian, call `pause()`.
- **Observe**: protocol paused; subsequent user-facing ops revert with `EnforcedPause`.
- **Pass**: pause effective.

### T-18.4 AuditorRegistry: add + remove

- **Steps**: Safe adds auditor pubkey; later removes it.
- **Observe**: state updates; auditor-mode access reflects.
- **Pass**: state correct.

---

## Day-19 — Artifact distribution

### T-19.1 Reproducible build across machines

- **Setup**: two engineers run the pinned Foundry + Noir Docker builds.
- **Observe**: SHA-256 of every emitted artifact matches.
- **Pass**: exact equality.

### T-19.2 ProtocolArtifactRegistry recorded

- **Steps**: read the on-chain registry; compare to CI-emitted hashes.
- **Observe**: equal.
- **Pass**: equality.

### T-19.3 IPFS round-trip

- **Steps**: pull artifacts via CID; hash; compare.
- **Observe**: equal.
- **Pass**: equality.

---

## Day-20 — Device support + server-assisted proving

### T-20.1 Low-tier prove latency

- **Setup**: throttle CPU to 4 cores; throttle network.
- **Steps**: trigger a borrow.
- **Observe**: server-assisted prove returns in < 30 s.
- **Pass**: latency bound met.

### T-20.2 Witness not persisted

- **Steps**: submit a witness; immediately read prover-service logs and storage.
- **Observe**: no witness contents in logs or any persistent store.
- **Pass**: clean.

### T-20.3 Trust UI visible

- **Steps**: choose server-assisted prove.
- **Observe**: UI shows the explanation copy about trust model.
- **Pass**: copy displayed.

---

## Day-21 — Final verification

### T-21.1 Full S15 invariant suite

- **Steps**: `forge test --match-test invariant_` across all contracts.
- **Observe**: 100% green.
- **Pass**: full green.

### T-21.2 APY simulation matches on chain

- **Steps**: Python reference simulator drives the same event log; compare indices.
- **Observe**: difference ≤ 1 wei rounding.
- **Pass**: within tolerance.

### T-21.3 k6 load test meets SLO

- **Steps**: `k6 run scripts/load.js`.
- **Observe**: p95 op latency ≤ 7 min; p95 subgraph lag ≤ 30 s.
- **Pass**: SLO met.

### T-21.4 system_check.md full suite

- **Steps**: run every group test in `system_check.md`.
- **Observe**: all green.
- **Pass**: all green.

---

## Cross-references

- Rules for running tests: [`agent_workflow_rules.md`](agent_workflow_rules.md) Rule 5
- Daily scope: [`code_roadmap.md`](code_roadmap.md)
- Group-level tests: [`system_check.md`](system_check.md)
- Where to record results: [`progress_tracker.md`](progress_tracker.md)
