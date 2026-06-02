# System Check — group-level integration tests

The tests in `subsystem_test.md` verify each day's deliverable in
isolation. The tests here verify that **groups of completed subsystems
work together correctly**. These run at planned checkpoints during the
21-day roadmap and again at the end.

If a group check fails, the agent **stops adding new subsystems** and
fixes the failing interaction (per `agent_workflow_rules.md` Rule 5).

## Checkpoint schedule

| When | Group | Reason |
|---|---|---|
| After Day 6 | **G1: On-chain core** (S01 + S02 + S12 + foundation contracts) | Lending contracts + circuits + custody round-trip works end-to-end before adding accounts/keepers |
| After Day 9 | **G2: Full chain stack** (G1 + S03 + S04 + S05) | Smart accounts, attestation, oracle, keepers wire correctly with the core |
| After Day 12 | **G3: Backend complete** (G2 + S06 + S13) | API surface stable; subgraph indexes correctly; SDKs work |
| After Day 16 | **G4: Both clients work** (G3 + S07 + S08) | Humans and agents both succeed against the live backend |
| After Day 19 | **G5: Operations complete** (G4 + S09 + S10 + S11) | Notes, governance, artifact distribution all integrated |
| After Day 21 | **G6: Full system + perf + threat-model** (G5 + S14 + S15 + S16 + S17) | Everything; ready for audit handoff |

---

## G1 — On-chain core (after Day 6)

### Scope
- S01: AssetRegistry, RateModel, Oracle, ShieldedSupplyPool, ShieldedPositionPool, LiquidationBoard, InsuranceFund, ZkVerifier
- S02: 11 circuits with real proofs
- S12: PrivacyEntry custody

### G1.1 — Multi-step lifecycle with real proofs (USDC)

- **Setup**: Anvil fork of Horizen testnet state; all G1 contracts deployed; real Noir-generated proofs.
- **Steps**:
  1. PrivacyEntry deposit 10,000 USDC.
  2. Supply 5,000 USDC.
  3. Deposit 4,000 USDC as collateral on a new position.
  4. Borrow 2,000 USDC (LTV well under 65%).
  5. Wait 30 days (`vm.warp`); call accrue.
  6. Repay 2,000 + interest.
  7. Withdraw collateral.
  8. Withdraw supply (including supply interest).
  9. PrivacyEntry exit remaining balance.
- **Observe**: I-SOLV-1 holds at every step; final ERC-20 balance = starting balance + supply interest − borrow interest paid.
- **Pass**: arithmetic consistent within 1 wei rounding; all 9 steps succeed.

### G1.2 — Multi-asset position lifecycle

- **Steps**: deposit USDC + cbBTC + WETH + ZEN collateral; borrow USDC; repay; withdraw all 4 collateral assets.
- **Observe**: per-slot indices on the position update correctly on each touch; cross-asset HF computed using Oracle prices for all 4.
- **Pass**: position closes cleanly; final note state matches inputs minus interest.

### G1.3 — Liquidation triggers fire correctly

- **Steps**: build a position at HF = 1.20; drop the oracle collateral price 25%; submit liquidation.
- **Observe**: HF crosses 1.0; LiquidationBoard accepts; close factor applied; bonus split 5/3.
- **Pass**: per S01 §3.

### G1.4 — Replay attempt across the loop

- **Steps**: capture nullifiers from G1.1; replay each.
- **Observe**: every replay reverts.
- **Pass**: I-REPLAY-1 holds.

### G1.5 — vkHash tampering

- **Steps**: deploy a different circuit's verifier under the wrong `circuitId`.
- **Observe**: any proof for that circuit reverts with `InvalidVkHash`.
- **Pass**: I-CRYPTO-5 holds.

---

## G2 — Full chain stack (after Day 9)

### Scope
- G1 + S03 (AgentAccount + PolicyRegistry) + S04 (attestation pipeline) + S05 (Oracle + keepers)

### G2.1 — Agent borrow on Horizen testnet with real attestation

- **Setup**: deploy on Horizen testnet; Kurier creds in env; AgentAccount with $100k USDC policy.
- **Steps**: agent submits a $50k borrow userOp → bundler → AgentAccount → policy passes → proof to Kurier → aggregation → ZkVerifier consumes → borrow executes.
- **Observe**: full pipeline completes; no manual intervention.
- **Pass**: success in < 7 min p95.

### G2.2 — Policy violation blocks attestation submission

- **Steps**: agent submits $150k borrow (over $100k cap).
- **Observe**: AgentAccount.validateUserOp reverts; no proof ever submitted to Kurier.
- **Pass**: violation caught at on-chain layer; no wasted proof.

### G2.3 — Keeper-driven accrue propagates through indices

- **Steps**: leave the protocol idle for 1 hour while keeper runs accrue every 5 min.
- **Observe**: borrowIndex and supplyIndex increase monotonically; no double-accrue.
- **Pass**: I-SOLV-2 holds.

### G2.4 — Stork price stall handled

- **Steps**: simulate Stork outage (price feed not updated for > staleness window).
- **Observe**: any oracle-dependent operation (borrow, liquidate, withdraw collateral) reverts with `PriceStale`.
- **Pass**: protocol fails closed.

### G2.5 — Session-key revocation propagates

- **Steps**: agent has active session; owner revokes via dapp; agent submits a new userOp.
- **Observe**: rejected in `validateUserOp`.
- **Pass**: revocation effective within 1 block.

---

## G3 — Backend complete (after Day 12)

### Scope
- G2 + S06 (data layer: subgraph + REST + MCP + Postgres + Redis) + S13 (API contracts published)

### G3.1 — REST intent end-to-end via testnet

- **Steps**: SDK-TS submits a deposit intent via `/intents/deposit`; polls `/jobs/{jobId}`.
- **Observe**: state progresses pending → submitted → finalised; subgraph reflects.
- **Pass**: terminal state finalised; on-chain tx confirmed.

### G3.2 — MCP equivalent of G3.1

- **Steps**: MCP client lists tools → calls `submitDeposit` tool.
- **Observe**: same final state; MCP tool returns the on-chain tx hash.
- **Pass**: success.

### G3.3 — Idempotency under concurrent submissions

- **Steps**: submit 10 identical intents with the same idempotency key in parallel.
- **Observe**: exactly one on-chain tx; all 10 responses share the same `jobId`.
- **Pass**: I-REPLAY-3 holds.

### G3.4 — Subgraph reflects within SLO

- **Steps**: emit 100 events; measure subgraph indexing lag.
- **Observe**: p95 lag ≤ 30 s (per S16 SLO).
- **Pass**: SLO met.

### G3.5 — DB failover behaviour

- **Setup**: kill the Postgres primary; the standby takes over.
- **Observe**: api-server reconnects and serves; in-flight intents recoverable.
- **Pass**: no data loss; service continues.

---

## G4 — Both clients work (after Day 16)

### Scope
- G3 + S07 (Next.js dapp) + S08 (agent runtime + SDKs)

### G4.1 — Human full loop via dapp on testnet

- **Steps**: connect wallet → deposit → supply → borrow → repay → withdraw.
- **Observe**: every step succeeds; UI reflects accurate balances from local notes (S09 partial).
- **Pass**: full loop in < 30 min wall-clock (per S16 cumulative).

### G4.2 — Agent full loop via SDK

- **Steps**: register policy; agent does deposit + supply + borrow + repay autonomously.
- **Observe**: every action respects policy; revocation tested mid-flow.
- **Pass**: agent stays within bounds.

### G4.3 — Liquidator dashboard + execution

- **Steps**: synthesize an underwater position; liquidator opens `/liquidator`; clicks LIQUIDATE.
- **Observe**: intent finalises; collateral seized to liquidator's entry note.
- **Pass**: success.

### G4.4 — Mixed-client traffic

- **Setup**: 5 humans + 5 agents acting concurrently for 30 min.
- **Observe**: no cross-user state contamination; all intents finalise correctly.
- **Pass**: clean.

---

## G5 — Operations complete (after Day 19)

### Scope
- G4 + S09 (notes) + S10 (governance) + S11 (artifact distribution)

### G5.1 — Note recovery from wallet only

- **Steps**: a real user account; wipe browser fully; re-sign in; re-scan chain.
- **Observe**: every owned note rebuilt; balance matches subgraph view.
- **Pass**: recovery succeeds; no manual data.

### G5.2 — Governance pause restores

- **Steps**: guardian pauses; users attempt ops; protocol reverts; Safe unpauses; users resume.
- **Observe**: clean pause/resume; no stuck state.
- **Pass**: success.

### G5.3 — Asset addition by governance

- **Steps**: Safe enables a new asset id; users can now supply it.
- **Observe**: AssetEnabled event; first supply succeeds.
- **Pass**: success.

### G5.4 — Reproducible build cross-verification

- **Steps**: Engineer A and B both run the pinned Docker build of the entire contracts + circuits codebase.
- **Observe**: SHA-256 of every artifact matches exactly.
- **Pass**: equality.

### G5.5 — ProtocolArtifactRegistry on chain matches CI

- **Steps**: read the registry; compare to CI build output.
- **Observe**: equal.
- **Pass**: equality; I-OPS-2 holds.

---

## G6 — Full system + perf + threat-model (after Day 21)

### Scope
- G5 + S14 (interest math) + S15 (threat model) + S16 (performance) + S17 (device support)

### G6.1 — Full S15 invariant suite

- **Steps**: run every invariant test (`forge test --match-test invariant_`).
- **Observe**: all green.
- **Pass**: full green; report attached to release-candidate doc.

### G6.2 — APY math matches reference simulation

- **Steps**: Python reference simulator drives the same event sequence as on chain; compare every index update.
- **Observe**: maximum drift ≤ 1 wei per index.
- **Pass**: within tolerance.

### G6.3 — k6 load test meets S16 SLOs

- **Setup**: testnet at realistic concurrency (50 ops/min).
- **Observe**: p95 operation latency ≤ 7 min; p95 subgraph lag ≤ 30 s; backend p95 ≤ 500ms per request.
- **Pass**: SLOs met.

### G6.4 — Low-tier device borrow

- **Setup**: throttled simulated device (4 CPU cores, slow network).
- **Steps**: borrow flow with server-assisted proving.
- **Observe**: prove latency < 30 s; UX progress shown end-to-end.
- **Pass**: latency met.

### G6.5 — Bug-bounty-style probe sample

- **Setup**: predefined adversarial scripts attempting common attacks (nullifier replay, vkHash bait-and-switch, custody overdraw, role escalation, idempotency bypass).
- **Observe**: all blocked.
- **Pass**: 0/N successful.

### G6.6 — Privacy assertion

- **Steps**: a third party reads the chain + subgraph; tries to derive any individual user's collateral, debt, or HF.
- **Observe**: only aggregate market metrics + per-position liquidation triggers visible. No per-user plaintext.
- **Pass**: I-PRIV-1 + I-PRIV-2 hold.

### G6.7 — Audit-handoff dry run

- **Steps**: generate the audit package (source + reproducible build artifacts + S15 invariant test report + threat model + spike outcomes + this group's results).
- **Observe**: every file present; SHA-256 of every artifact recorded.
- **Pass**: package complete.

---

## Failure handling at checkpoint

If any group check fails:
1. **Stop the roadmap.** Do not begin the next day.
2. **Diagnose**: which subsystem's interaction is wrong?
3. **Fix in the responsible subsystem** (the one that owns the defective edge per `connections.md`).
4. **Re-run the failing group check** AND the original day's per-subsystem tests.
5. **Update `progress_tracker.md`** with the failure cause, fix, and re-run result.
6. **If the failure reveals a design issue**, flag a `🛠️ DESIGN DRIFT` (per `agent_workflow_rules.md` Rule 8).

## Test data and accounts

- All tests use throwaway accounts seeded with test ETH from Horizen testnet faucet.
- KMS keys for keepers are test-only KMS keys (per `architecture_context.md` §1.6); never used for mainnet.
- Fixtures committed to `code/test-fixtures/` are deterministic and reproducible.

## Cross-references

- Per-day tests: [`subsystem_test.md`](subsystem_test.md)
- Subsystem composition: [`connections.md`](connections.md)
- Invariants: [`architecture_context.md`](architecture_context.md) §4
- Threat model: [`../subsystems/15_threat_model.md`](../subsystems/15_threat_model.md)
- Performance SLOs: [`../subsystems/16_performance.md`](../subsystems/16_performance.md)
