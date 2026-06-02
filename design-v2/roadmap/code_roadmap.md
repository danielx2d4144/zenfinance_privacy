# Code Roadmap — 21-day implementation plan

One subsystem (or a slice of one) per day. Bigger subsystems span
multiple consecutive days. **The coding agent reads this file at the
start of every session** and works ONLY on the current day's scope.

## How to read each day

Each day specifies:
- **Subsystem** — the design-v2 subsystem being implemented.
- **Reference docs** — the `../subsystems/NN_*.md` file(s) the agent MUST read in full before coding.
- **External services / APIs** — services and credentials needed for the day's work.
- **External reference docs** — links / paths to third-party documentation the agent must consult.
- **Goals** — the concrete deliverables for the day.
- **How to achieve** — the recommended path through the day.
- **Done when** — the verifiable criteria signaling the day is complete.
- **Tests** — which tests from `subsystem_test.md` to run.

If a day's scope can't be finished within the budgeted session, the
agent flags a `⏱️ TIME OVERRUN` (per `agent_workflow_rules.md` Rule 13).

---

## Phase mapping

| Days | Phase | Subsystems |
|---|---|---|
| 1-3 | On-chain contracts | S01, S12 (contracts only) |
| 4-5 | ZK circuits | S02 |
| 6 | PrivacyEntry layer | S12 (full) |
| 7 | Smart accounts & policies | S03 |
| 8 | Attestation pipeline | S04 |
| 9 | Oracle & keepers | S05 |
| 10-11 | Data layer | S06 |
| 12 | API contract artifacts | S13 |
| 13-15 | Human frontend | S07 |
| 16 | Agent runtime & SDKs | S08 |
| 17 | Note management | S09 |
| 18 | Governance & admin | S10 |
| 19 | Artifact distribution | S11 |
| 20 | Device support & adaptive proving | S17 |
| 21 | Integration, perf, threat-model validation | S14 + S15 + S16 |

---

## Day 1 — AssetRegistry + RateModel + Oracle (foundation contracts)

### Subsystem
S01 (Shielded Pools) — foundational contracts only. Pools come Day 2-3.

### Reference docs
- [`../subsystems/01_shielded_pools.md`](../subsystems/01_shielded_pools.md) §1-§3, §6
- [`../subsystems/14_interest_and_apys.md`](../subsystems/14_interest_and_apys.md) §3-§5 (rate-model math)
- [`../subsystems/05_oracle_and_keepers.md`](../subsystems/05_oracle_and_keepers.md) §2 (oracle interface)
- `architecture_context.md` §1.1, §4.2 (solvency invariants)
- `code_standard.md` §2 (Solidity)

### External services / APIs
- None for today (pure on-chain contract authoring + local Foundry).

### External reference docs
- OpenZeppelin Contracts v5 docs: <https://docs.openzeppelin.com/contracts/5.x/>
  - `AccessControl`, `Pausable`, `ReentrancyGuard`, `SafeERC20`
- Foundry book: <https://book.getfoundry.sh/>
- Solidity 0.8.27 release notes: <https://soliditylang.org/blog/2024/09/04/solidity-0.8.27-release-announcement/>
- Aave v3.3 rate-model reference: <https://github.com/aave/aave-v3-origin/tree/main/src/contracts/protocol/pool>

### Goals
1. `contracts/foundry.toml` — pin Solidity 0.8.27, optimizer 200, `via_ir=true`.
2. `contracts/src/AssetRegistry.sol` — per-asset config (LTV, LT, bonus, reserveFactor, kink, ratesPerSecond) gated by `MANAGER_ROLE`.
3. `contracts/src/RateModel.sol` — pure functions for `utilization`, `borrowRatePerSecond`, `supplyRatePerSecond`, `accrue(uint8 assetId)`.
4. `contracts/src/Oracle.sol` — Stork adapter interface; per-asset `getPrice(uint8 assetId)` with staleness window check.
5. Custom errors, events, NatSpec, `nonReentrant` + `whenNotPaused` on every state-mutating external.

### How to achieve
1. `forge init contracts/` if not already initialised; install OpenZeppelin v5.
2. Author `AssetRegistry.sol` first; it's the canonical asset-id source.
3. Author `RateModel.sol` next as a stateless math library called by pools.
4. Author `Oracle.sol` as a thin adapter — Stork integration details are S05 (Day 9).
5. Write Foundry unit tests as each file is added (`test/AssetRegistry.t.sol`, etc.).

### Done when
- [ ] All three contracts compile with `forge build` (no warnings).
- [ ] `forge coverage` shows ≥95% on each new file.
- [ ] All `test_*` and `testRevert_*` cases pass.
- [ ] `progress_tracker.md` updated.

### Tests
Run section **Day-1** in `subsystem_test.md`.

---

## Day 2 — PrivacyEntry + InsuranceFund + ZkVerifier

### Subsystem
S12 (PrivacyEntry custody) and S01 (InsuranceFund, ZkVerifier).

### Reference docs
- [`../subsystems/12_privacy_entry_layer.md`](../subsystems/12_privacy_entry_layer.md) (full file)
- [`../subsystems/01_shielded_pools.md`](../subsystems/01_shielded_pools.md) §4 (InsuranceFund), §5 (ZkVerifier)
- [`../subsystems/04_attestation_pipeline.md`](../subsystems/04_attestation_pipeline.md) §2 (verifier interface)
- `architecture_context.md` §3 (PrivacyEntry custody boundary)

### External services / APIs
- None for today.

### External reference docs
- `IVerifyProofAggregation` ABI: <https://github.com/HorizenLabs/zkv-attestation-contracts>
- zkVerify domain IDs reference: <https://docs.zkverify.io/architecture/system-domain>
- Aztec Connect pattern background: <https://medium.com/aztec-protocol/aztec-connect-launch-8b13b3c5b78a>

### Goals
1. `contracts/src/PrivacyEntry.sol` — single custody contract holding all assets; `appCustody[assetId][token]` accounting; `POOL_ROLE` gating; entry/exit one-shot externals.
2. `contracts/src/InsuranceFund.sol` — reserve accumulator; `cover(uint256 amount, uint8 assetId)` callable only by pools.
3. `contracts/src/ZkVerifier.sol` — wraps `IVerifyProofAggregation`; pins `vkHash` per circuit at construction; verifies `(aggregationId, domainId, leafIndex, merklePath, publicInputs)` tuple.
4. `(domainId, aggregationId, leafIndex)` consumption tracking (anti-replay).

### How to achieve
1. PrivacyEntry first — every pool needs its address in constructor.
2. ZkVerifier next — pools reference it; pins `vkHash[circuitId]`.
3. InsuranceFund last — simplest of the three.
4. Foundry tests for `POOL_ROLE` gating, double-consumption rejection, custody arithmetic.

### Done when
- [ ] PrivacyEntry rejects EOA caller for `withdraw*` flows.
- [ ] ZkVerifier rejects `vkHash` mismatch with `InvalidVkHash`.
- [ ] Double-consuming the same `(domainId, aggregationId, leafIndex)` reverts with `AggregationAlreadyConsumed`.
- [ ] `progress_tracker.md` updated.

### Tests
Run section **Day-2** in `subsystem_test.md`.

---

## Day 3 — ShieldedSupplyPool + ShieldedPositionPool + LiquidationBoard

### Subsystem
S01 (Shielded Pools — the four lending contracts).

### Reference docs
- [`../subsystems/01_shielded_pools.md`](../subsystems/01_shielded_pools.md) (full file)
- [`../subsystems/02_zk_circuits.md`](../subsystems/02_zk_circuits.md) §3 (public inputs per circuit)
- [`../subsystems/14_interest_and_apys.md`](../subsystems/14_interest_and_apys.md) §6 (index updates)

### External services / APIs
- None for today.

### External reference docs
- Tornado Nova reference: <https://github.com/tornadocash/tornado-nova>
- Poseidon hash spec (constants used in circuits): <https://github.com/iden3/iden3-docs/blob/master/source/iden3_repos/research/publications/zkproof-standards-workshop-2/poseidon/poseidon.md>

### Goals
1. `contracts/src/ShieldedSupplyPool.sol` — `supply` and `withdraw_supply` externals; commitments tree; nullifier set; per-asset supplyIndex update via `RateModel.accrue`.
2. `contracts/src/ShieldedPositionPool.sol` — `borrow`, `repay`, `deposit_collateral`, `withdraw_collateral` externals; position commitments; multi-slot positions (USDC + cbBTC + WETH + ZEN); health-factor public-input check.
3. `contracts/src/LiquidationBoard.sol` — `liquidate(target, collateralAsset, debtAsset)` external; liquidation trigger registry; close-factor logic (50% / 100% at HF<0.95); 8% bonus split (5% liquidator + 3% InsuranceFund).
4. Wire pools to PrivacyEntry via `POOL_ROLE`.

### How to achieve
1. ShieldedSupplyPool first (simplest; one circuit family).
2. ShieldedPositionPool next (multi-slot; reuses supply patterns).
3. LiquidationBoard last (reuses position-pool primitives).
4. After each contract, run its Foundry test file before moving on.

### Done when
- [ ] All four pool contracts compile.
- [ ] PrivacyEntry's `POOL_ROLE` granted to the three pool addresses in a deployment script.
- [ ] Solvency invariants I-SOLV-1, I-SOLV-3 covered by an invariant test.
- [ ] `progress_tracker.md` updated.

### Tests
Run section **Day-3** in `subsystem_test.md`.

---

## Day 4 — Noir circuits: entry, supply, withdraw, deposit-collateral

### Subsystem
S02 (ZK Circuits — first half).

### Reference docs
- [`../subsystems/02_zk_circuits.md`](../subsystems/02_zk_circuits.md) §1-§5
- [`../subsystems/09_note_management.md`](../subsystems/09_note_management.md) §2 (note schema)
- [`../subsystems/12_privacy_entry_layer.md`](../subsystems/12_privacy_entry_layer.md) §4 (entry/exit semantics)

### External services / APIs
- None for today (local `nargo` + `bb` v3.0.0).

### External reference docs
- Noir book: <https://noir-lang.org/docs>
- Barretenberg `bb` CLI: <https://github.com/AztecProtocol/aztec-packages/tree/master/barretenberg>
- UltraHonk-ZK flavour notes: <https://noir-lang.org/docs/getting_started/quick_start#using-barretenberg>

### Goals
1. `circuits/crates/entry_deposit/` — proves a public deposit produced a private commitment.
2. `circuits/crates/entry_withdraw/` — proves a private balance covers a public withdrawal.
3. `circuits/crates/supply_asset/` — proves supplying tokens; updates supply note + walks all slots to refresh indices.
4. `circuits/crates/withdraw_supply/` — proves withdrawal from supply with current `supplyIndex`.
5. `circuits/crates/deposit_collateral/` — proves collateral deposit into a multi-asset position.
6. Generate `Verifier.sol` for each circuit; commit the artifact under `contracts/src/verifiers/`.

### How to achieve
1. `nargo new <circuit>` per circuit.
2. Implement common helpers in a shared crate (`circuits/crates/common/`): Poseidon, Merkle, note encoding.
3. Author each circuit; run `nargo check` after every assertion added.
4. `nargo execute` with fixture inputs in `Prover.toml`.
5. `bb prove` to generate proof; `bb write_solidity_verifier` to emit `Verifier.sol`.
6. Compute `vkHash` (sha256 of vk bytes) and record for Day 2's ZkVerifier configuration.

### Done when
- [ ] All 5 circuits compile (`nargo compile`).
- [ ] Each circuit has `tests/` with happy path + ≥3 failure-mode fixtures, all `nargo test` passing.
- [ ] `Verifier.sol` emitted for each; `vkHash` recorded in `progress_tracker.md`.

### Tests
Run section **Day-4** in `subsystem_test.md`.

---

## Day 5 — Noir circuits: borrow, repay, liquidate, consolidate, triggers

### Subsystem
S02 (ZK Circuits — second half).

### Reference docs
- [`../subsystems/02_zk_circuits.md`](../subsystems/02_zk_circuits.md) §6-§9
- [`../subsystems/01_shielded_pools.md`](../subsystems/01_shielded_pools.md) §3 (liquidation math)
- [`../subsystems/14_interest_and_apys.md`](../subsystems/14_interest_and_apys.md) §8 (per-position health factor)

### External services / APIs
- None for today.

### External reference docs
- Same as Day 4.

### Goals
1. `circuits/crates/withdraw_collateral/` — proves withdrawal with post-op `healthFactor ≥ 1.0`.
2. `circuits/crates/borrow/` — proves new debt commitment + HF check.
3. `circuits/crates/repay/` — proves debt reduction + correct interest accrual.
4. `circuits/crates/liquidate/` — proves close-factor logic + bonus split.
5. `circuits/crates/consolidate_balance/` — note compaction across same-asset slots.
6. `circuits/crates/compute_triggers/` — derives per-position liquidation prices (public output).

### How to achieve
1. Reuse the common crate from Day 4.
2. Borrow, repay, liquidate share the multi-slot walker — extract it once.
3. Liquidate is the most adversarial; write the most failure-mode fixtures here.
4. Differential test: 100 random valid witnesses, all must verify.

### Done when
- [ ] All 11 circuits (Day 4 + Day 5) compile and verify against their reference proofs.
- [ ] Adversarial corpus (100 invalid witnesses) all fail.
- [ ] `Verifier.sol` emitted for each new circuit; `vkHash` recorded.

### Tests
Run section **Day-5** in `subsystem_test.md`.

---

## Day 6 — PrivacyEntry end-to-end + Day-3 wiring complete

### Subsystem
S12 (PrivacyEntry full integration with circuits).

### Reference docs
- [`../subsystems/12_privacy_entry_layer.md`](../subsystems/12_privacy_entry_layer.md) (full)
- [`../subsystems/02_zk_circuits.md`](../subsystems/02_zk_circuits.md) §10 (entry/exit circuits binding)

### External services / APIs
- Local Anvil only.

### External reference docs
- None new.

### Goals
1. Wire `entry_deposit` and `entry_withdraw` circuits into PrivacyEntry (set `vkHash` constants via ZkVerifier).
2. End-to-end Foundry test: external token → PrivacyEntry deposit → supply note → withdrawal back to external address.
3. Verify `appCustody[token]` accounting is exact across the loop.
4. Verify the `nullifierHash` on entry-withdraw is recorded once and cannot be replayed.

### Goals
1. Stage of full local stack: PrivacyEntry + supply pool + position pool + verifier with real proofs.
2. Document the local-dev runbook in `ops/runbooks/local-dev.md`.

### Done when
- [ ] Foundry test `test/integration/EntryFlow.t.sol` passes end-to-end with real Noir proofs.
- [ ] Custody accounting matches expected balances at every step.
- [ ] I-CRYPTO-1, I-CRYPTO-2, I-REPLAY-1, I-REPLAY-4 invariants explicitly asserted.

### Tests
Run section **Day-6** in `subsystem_test.md`.

---

## Day 7 — Smart accounts (ERC-4337) + Policies

### Subsystem
S03 (Smart Accounts & Policies).

### Reference docs
- [`../subsystems/03_smart_accounts_policies.md`](../subsystems/03_smart_accounts_policies.md) (full)
- `architecture_context.md` §1.1 (ERC-4337 v0.7.0 pin)

### External services / APIs
- **DECISION NEEDED (Q2)**: confirm canonical EntryPoint address on Horizen testnet, or deploy our own. Flag a `🔔 DECISION NEEDED` per `agent_workflow_rules.md` Rule 2 if the canonical answer isn't documented in the Horizen docs.

### External reference docs
- ERC-4337 v0.7.0 spec: <https://eips.ethereum.org/EIPS/eip-4337>
- eth-infinitism reference: <https://github.com/eth-infinitism/account-abstraction>
- Bundler reference: <https://github.com/eth-infinitism/bundler>

### Goals
1. `contracts/src/AgentAccount.sol` — ERC-4337 smart account; session-key delegation; policy-enforced `validateUserOp`.
2. `contracts/src/PolicyRegistry.sol` — owner-signed policies (per-asset spending caps, HF floor, expiry).
3. Foundry tests for: valid userOp accepted, over-cap userOp rejected, HF-floor violation rejected, expired session rejected.

### How to achieve
1. Read `eth-infinitism/account-abstraction` v0.7.0 source for the EntryPoint contract interface.
2. Author `AgentAccount.sol` extending the v0.7.0 base; override `_validateOp` for policy checks.
3. Author `PolicyRegistry.sol` next; policies are owner-signed off-chain, on-chain verified via `ECDSA.recover`.
4. Test session-key revocation explicitly (must be instant).

### Done when
- [ ] AgentAccount accepts a userOp signed by an authorised session key.
- [ ] AgentAccount rejects a userOp that violates any registered policy.
- [ ] Owner can revoke a session key in 1 tx; subsequent userOps from that key fail.

### Tests
Run section **Day-7** in `subsystem_test.md`.

---

## Day 8 — Attestation pipeline (Kurier → zkVerify → Horizen)

### Subsystem
S04 (Attestation Pipeline).

### Reference docs
- [`../subsystems/04_attestation_pipeline.md`](../subsystems/04_attestation_pipeline.md) (full)

### External services / APIs
- **Kurier REST API** (testnet endpoint per Q2.2 resolution). Credentials per `architecture_context.md` §1.6.
- **zkVerify Volta testnet** — RPC URL.
- **Horizen testnet** — RPC URL.

### External reference docs
- Kurier API: <https://docs.zkverify.io/architecture/kurier>
- zkVerify proof submission flow: <https://docs.zkverify.io/architecture/proof-submission>
- Horizen testnet RPC: <https://docs.horizenlabs.io/network>

### Goals
1. `backend/prover-service/` — submits compiled proofs to Kurier; polls for `(domainId, aggregationId, leafIndex, merklePath)` tuple.
2. Relayer keeper: monitors zkVerify for finalised aggregations; calls Horizen proxy to publish the aggregation root.
3. On Horizen, the `ZkVerifier` contract from Day 2 consumes the tuple.

### How to achieve
1. Verify Kurier endpoint shape with a manual `curl` against testnet (per Rule 1 — no hallucination).
2. Write `backend/prover-service/src/kurier-client.ts` with explicit zod schemas for request/response.
3. Implement retry + idempotency-key headers.
4. End-to-end smoke test: submit a proof → poll → consume on Horizen testnet → check storage updated.

### Done when
- [ ] Real proof flow from local generation → Kurier → zkVerify → Horizen consumed in a single test run.
- [ ] Failure paths handled: Kurier 429, zkVerify aggregation not yet finalised, Horizen tx reverts.
- [ ] `progress_tracker.md` records the exact endpoint URLs + credential placeholders used (no secrets committed).

### Tests
Run section **Day-8** in `subsystem_test.md`.

---

## Day 9 — Oracle + Keepers

### Subsystem
S05 (Oracle & Keepers).

### Reference docs
- [`../subsystems/05_oracle_and_keepers.md`](../subsystems/05_oracle_and_keepers.md) (full)

### External services / APIs
- **Stork on-chain oracle** (per Q2.5 resolution). Testnet feed addresses required.

### External reference docs
- Stork docs: <https://docs.stork.network/>

### Goals
1. Complete `contracts/src/Oracle.sol` with Stork pull adapter (was stubbed Day 1).
2. `backend/keeper/` Node service:
   - **Price keeper**: pulls Stork prices; pushes via `Oracle.setPrice` on a cadence.
   - **Accrue keeper**: calls `accrue(assetId)` per asset on a cadence matched to S14 §6.
   - **Backstop keeper**: monitors LiquidationBoard for stale liquidations.
3. KMS-backed signing for keeper EOAs (no plaintext keys anywhere).

### How to achieve
1. Wire Stork SDK to Oracle.
2. Keepers are simple cron-style workers; one file each in `backend/keeper/src/`.
3. AWS KMS integration for signing — verify exact API per AWS docs before writing.

### Done when
- [ ] Oracle returns Stork prices on Horizen testnet.
- [ ] Three keepers run on a local docker compose; logs visible in CloudWatch shape.
- [ ] Manual fault injection: pause keeper; verify protocol still safe (no liquidation cascade).

### Tests
Run section **Day-9** in `subsystem_test.md`.

---

## Day 10 — Data layer: subgraph + Postgres schema

### Subsystem
S06 (Data Layer — first half).

### Reference docs
- [`../subsystems/06_data_layer.md`](../subsystems/06_data_layer.md) §1-§4

### External services / APIs
- **Goldsky** (per Q2.3 resolution). API key required.
- **PostgreSQL 16** (local docker for dev).

### External reference docs
- Goldsky subgraph docs: <https://docs.goldsky.com/subgraphs/introduction>
- The Graph mappings format: <https://thegraph.com/docs/en/developing/creating-a-subgraph/>

### Goals
1. `subgraph/schema.graphql` — entities for: Market, AssetConfig, AggregationConsumed, Nullifier (hash only), Commitment (root only), LiquidationCalled.
2. `subgraph/src/mappings/` — handlers for every event emitted by Day-1/2/3 contracts.
3. `backend/api-server/db/migrations/01__init.sql` — Postgres tables for intents, jobs, idempotency keys, audit log.

### How to achieve
1. Subgraph schema derived from event signatures in the contracts.
2. Test subgraph locally with `goldsky subgraph build` and `--watch`.
3. Postgres migrations append-only per `code_standard.md` §6.

### Done when
- [ ] Subgraph indexes a local Anvil deployment; entity counts match expected events.
- [ ] Postgres schema applied; rollback (down) migrations verified to work.

### Tests
Run section **Day-10** in `subsystem_test.md`.

---

## Day 11 — Data layer: REST API + MCP server

### Subsystem
S06 (Data Layer — second half).

### Reference docs
- [`../subsystems/06_data_layer.md`](../subsystems/06_data_layer.md) §5-§9
- [`../subsystems/13_api_contract.md`](../subsystems/13_api_contract.md) (referenced for the schemas)

### External services / APIs
- None new today.

### External reference docs
- NestJS docs: <https://docs.nestjs.com/>
- MCP SDK (TypeScript): <https://modelcontextprotocol.io/sdk>
- OpenAPI 3.1 spec: <https://spec.openapis.org/oas/v3.1.0>

### Goals
1. `backend/api-server/` — REST server (NestJS or Fastify per `architecture_context.md` §1.3) implementing every intent in S13.
2. MCP server module exposing the same intents as MCP tools (per Q5 design).
3. Zod schemas shared with SDKs (single source of truth = S13).
4. Idempotency: every intent submission stores the key (24h TTL) and dedupes.

### How to achieve
1. **DECISION (Day 16)**: NestJS vs Fastify. Decide today before starting; flag `🔔 DECISION NEEDED` if ambiguous.
2. One controller per intent kind: deposit, supply, borrow, repay, liquidate, withdraw.
3. MCP tools mirror the REST shape; same zod schema reused.
4. Auth: bearer token signed by user's wallet (EIP-4361 sign-in-with-Ethereum).

### Done when
- [ ] Submit a BORROW intent; receives a `jobId`; polling returns `pending → submitted → finalised` over time.
- [ ] MCP `tools/list` returns the full catalog.
- [ ] OpenAPI 3.1 spec exported at `/openapi.json`.

### Tests
Run section **Day-11** in `subsystem_test.md`.

---

## Day 12 — API contract artifacts (OpenAPI + MCP catalog + SDK stubs)

### Subsystem
S13 (API Contract).

### Reference docs
- [`../subsystems/13_api_contract.md`](../subsystems/13_api_contract.md) (full)

### External services / APIs
- None new today.

### External reference docs
- OpenAPI Generator: <https://openapi-generator.tech/>
- MCP catalog spec: <https://modelcontextprotocol.io/specification>

### Goals
1. Generate `sdk-ts/` TypeScript client from OpenAPI spec.
2. Generate `sdk-py/` Python client from OpenAPI spec.
3. Publish the MCP catalog JSON to `code/docs/mcp-catalog.json`.
4. Author `code/docs/api-contract.md` linking the spec to design-v2/subsystems/13.

### How to achieve
1. Use OpenAPI Generator's `typescript-fetch` and `python` templates.
2. Wrap generated clients with idiomatic helpers (`@lending/sdk-ts`, `lending-agent-py`).
3. Smoke tests for both SDKs against the running API server from Day 11.

### Done when
- [ ] Both SDKs build cleanly.
- [ ] An example program in each SDK successfully submits a deposit intent.
- [ ] OpenAPI lint clean (`spectral lint`).

### Tests
Run section **Day-12** in `subsystem_test.md`.

---

## Day 13 — Human frontend (Next.js scaffolding + wallet + privacy entry UX)

### Subsystem
S07 (Human Frontend — Part 1).

### Reference docs
- [`../subsystems/07_human_frontend.md`](../subsystems/07_human_frontend.md) §1-§4
- [`../subsystems/12_privacy_entry_layer.md`](../subsystems/12_privacy_entry_layer.md) §6 (UX considerations)

### External services / APIs
- WalletConnect v2 project ID (free tier).

### External reference docs
- Next.js 14 docs: <https://nextjs.org/docs>
- wagmi v2: <https://wagmi.sh/>
- RainbowKit: <https://www.rainbowkit.com/>
- ethers v6: <https://docs.ethers.org/v6/>

### Goals
1. `dapp/` Next.js 14 App Router scaffold.
2. Connect-wallet flow with WalletConnect v2 + MetaMask + Coinbase + SubWallet.
3. PrivacyEntry deposit/withdraw screens (the only "public" interactions).
4. `useWallet()` hook (single source of wallet state per `code_standard.md` §4.6).

### How to achieve
1. `pnpm create next-app dapp` with App Router + Tailwind + TypeScript strict.
2. Spending-key derivation in-browser (`window.ethereum` signature → HKDF → Poseidon key).
3. **NEVER** persist the spending key (per I-CRYPTO-1).

### Done when
- [ ] dapp builds; `pnpm build` clean.
- [ ] Connect MetaMask to Horizen testnet; spending key derived and held only in React state.
- [ ] Deposit to PrivacyEntry; UI shows the new private balance.

### Tests
Run section **Day-13** in `subsystem_test.md`.

---

## Day 14 — Human frontend (supply / borrow / repay flows + browser proving)

### Subsystem
S07 (Human Frontend — Part 2).

### Reference docs
- [`../subsystems/07_human_frontend.md`](../subsystems/07_human_frontend.md) §5-§7
- [`../subsystems/17_device_support.md`](../subsystems/17_device_support.md) §3-§4 (device-class branching)

### External services / APIs
- None new today.

### External reference docs
- `@aztec/bb.js` browser docs: <https://www.npmjs.com/package/@aztec/bb.js>
- Web Workers MDN: <https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API>

### Goals
1. Supply, borrow, repay, withdraw-collateral screens.
2. In-browser proving via `@aztec/bb.js` in a Web Worker (off main thread).
3. Adaptive proving: detect device class on first visit; offer server-assisted prove for low-tier devices (per S17).
4. Progress UI for the 3-7 min aggregation latency (per S16).

### How to achieve
1. One screen per intent kind; consistent layout via shared components.
2. Web Worker file per circuit; main thread sends witness, worker returns proof.
3. Device-class detection via `navigator.hardwareConcurrency` + a 5-second bench prove.

### Done when
- [ ] Each intent flow works end-to-end on Horizen testnet.
- [ ] Browser prover does not block the main thread (UI stays responsive during proving).
- [ ] Server-assisted prove fallback works for the simulated low-tier path.

### Tests
Run section **Day-14** in `subsystem_test.md`.

---

## Day 15 — Human frontend (liquidator board + auditor mode + i18n + a11y pass 1)

### Subsystem
S07 (Human Frontend — Part 3).

### Reference docs
- [`../subsystems/07_human_frontend.md`](../subsystems/07_human_frontend.md) §8-§10
- [`../subsystems/17_device_support.md`](../subsystems/17_device_support.md) §6 (a11y + i18n)

### External services / APIs
- None new today.

### External reference docs
- `next-intl`: <https://next-intl.dev/>
- WCAG 2.1 AA: <https://www.w3.org/WAI/WCAG21/quickref/?versions=2.1&levels=aa>
- `axe-core` for automated a11y: <https://github.com/dequelabs/axe-core>

### Goals
1. Liquidator board page: lists positions where `currentPrice < trigger`, one-click LIQUIDATE intent.
2. Auditor-mode route (`/auditor`) — for users who pre-registered an auditor opt-in.
3. `next-intl` framework wired with `en` only (5 more languages in v1.1).
4. Self-test with `axe-core` — no critical violations.

### How to achieve
1. Liquidator board queries the subgraph directly (read-only).
2. Auditor mode reuses the same dapp with route-level gating.
3. Run `pnpm dlx @axe-core/cli http://localhost:3000` against each page.

### Done when
- [ ] Liquidator can find + submit a liquidation in the dapp.
- [ ] All visible strings extracted to `messages/en.json`.
- [ ] `axe-core` passes (no critical/serious issues).

### Tests
Run section **Day-15** in `subsystem_test.md`.

---

## Day 16 — Agent runtime + SDK polish

### Subsystem
S08 (Agent Runtime).

### Reference docs
- [`../subsystems/08_agent_runtime.md`](../subsystems/08_agent_runtime.md) (full)

### External services / APIs
- None new today.

### External reference docs
- MCP client patterns: <https://modelcontextprotocol.io/clients>

### Goals
1. Example agent: a TypeScript script that uses `@lending/sdk-ts` + MCP to (a) discover tools, (b) submit a BORROW within a session policy, (c) handle the streaming intent status.
2. Example agent: Python equivalent using `lending-agent-py`.
3. Document `code/docs/agent-getting-started.md`.

### How to achieve
1. Reuse SDKs from Day 12.
2. Demonstrate session-key delegation: owner signs policy → registers on chain → hands session key to agent.
3. Show revocation: owner revokes session → agent receives 403 on next call.

### Done when
- [ ] Both example agents successfully borrow on Horizen testnet within policy.
- [ ] Revocation kicks in within one block.

### Tests
Run section **Day-16** in `subsystem_test.md`.

---

## Day 17 — Note management

### Subsystem
S09 (Note Management).

### Reference docs
- [`../subsystems/09_note_management.md`](../subsystems/09_note_management.md) (full)

### External services / APIs
- IPFS via Pinata + Filebase (per Q2.7).

### External reference docs
- Pinata API: <https://docs.pinata.cloud/>
- Filebase API: <https://docs.filebase.com/>

### Goals
1. Client-side note store (IndexedDB) — encrypted by the spending key.
2. Optional encrypted backup to IPFS (user-opt-in).
3. Note compaction flow (`consolidate_balance` circuit from Day 5).
4. Recovery flow: from wallet signature → re-derive spending key → re-scan chain → rebuild notes.

### How to achieve
1. Encrypted blob in IndexedDB; key never leaves React state.
2. Optional Pinata + Filebase pin (mirrored for redundancy).
3. Recovery test: wipe browser storage; verify wallet signature alone rebuilds notes.

### Done when
- [ ] Notes persist across browser sessions.
- [ ] Manual recovery from a clean browser succeeds.
- [ ] Consolidate-balance shrinks N small notes into 1 with the same value.

### Tests
Run section **Day-17** in `subsystem_test.md`.

---

## Day 18 — Governance + Safe + AuditorRegistry

### Subsystem
S10 (Governance & Admin).

### Reference docs
- [`../subsystems/10_governance_admin.md`](../subsystems/10_governance_admin.md) (full)

### External services / APIs
- **Den / Safe on Horizen** (per Q2.4).

### External reference docs
- Safe docs: <https://docs.safe.global/>
- Den docs (if available on Horizen): <https://docs.onchainden.com/>

### Goals
1. Deploy Safe on Horizen testnet; configure 3-of-5 threshold (per S10 §2).
2. Grant `ADMIN_ROLE` on every contract from Day 1-3 to the Safe address.
3. `contracts/src/AuditorRegistry.sol` — list of approved auditor public keys.
4. Document all admin operations runbook in `ops/runbooks/admin-operations.md`.

### How to achieve
1. Deploy Safe via Safe UI; record the address.
2. Run a script that calls `grantRole(ADMIN_ROLE, safeAddr)` then `revokeRole(ADMIN_ROLE, deployerEoa)` on every contract.
3. Test an admin operation end-to-end via Safe UI.

### Done when
- [ ] No EOA holds `ADMIN_ROLE` on any contract.
- [ ] Adding a new auditor via Safe works end-to-end.
- [ ] Pause via guardian hardware wallet works.

### Tests
Run section **Day-18** in `subsystem_test.md`.

---

## Day 19 — Artifact distribution + reproducible build

### Subsystem
S11 (Artifact Distribution).

### Reference docs
- [`../subsystems/11_artifact_distribution.md`](../subsystems/11_artifact_distribution.md) (full)

### External services / APIs
- None new today (uses Pinata + Filebase from Day 17).

### External reference docs
- Docker Buildx: <https://docs.docker.com/build/buildx/>
- Foundry deterministic builds: <https://book.getfoundry.sh/forge/build-options>

### Goals
1. `ops/docker/foundry.Dockerfile` — pinned Foundry image.
2. `ops/docker/noir.Dockerfile` — pinned Noir + bb image.
3. CI workflow (`.github/workflows/build.yml`) — builds artifacts; emits SHA-256 hashes; compares to last build.
4. `contracts/src/ProtocolArtifactRegistry.sol` — on-chain registry of artifact hashes.
5. Publish initial artifacts to IPFS.

### How to achieve
1. Pin every image by digest, not tag.
2. Two engineers run the build independently; hashes must match exactly (per S11).
3. Upload artifacts to Pinata + Filebase; record CIDs in `ProtocolArtifactRegistry`.

### Done when
- [ ] Reproducible-build check passes across two machines.
- [ ] Artifact CIDs recorded on chain.

### Tests
Run section **Day-19** in `subsystem_test.md`.

---

## Day 20 — Device support + server-assisted proving service

### Subsystem
S17 (Device Support).

### Reference docs
- [`../subsystems/17_device_support.md`](../subsystems/17_device_support.md) (full)

### External services / APIs
- AWS EC2 for the prover service (per Q2.1).

### External reference docs
- AWS EC2 launch templates: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-launch-templates.html>

### Goals
1. `backend/prover-service/` (expand on Day 8) — accept witnesses from low-tier devices; produce proofs; return.
2. Trust model documented (Flavor A in v1; Flavor B TEE deferred to v1.5).
3. Rate limits, authentication, and audit logging.
4. Device-class detection UX in dapp (already done Day 14, polish here).

### How to achieve
1. Single-tenant per request; no witness ever persisted.
2. JWT-authenticated per session; one prove per token.
3. Verify on dispatch that the witness shape matches a known circuit's `Prover.toml` schema.

### Done when
- [ ] Server-assisted prove latency for a low-tier mobile is < 30s.
- [ ] Prover service does not log witness contents (verified by reading logs).
- [ ] Trust model documented in user-facing copy on dapp.

### Tests
Run section **Day-20** in `subsystem_test.md`.

---

## Day 21 — Integration + S14 verification + S15 invariants + S16 SLOs

### Subsystem
S14 (interest), S15 (threats), S16 (performance) — verification pass.

### Reference docs
- [`../subsystems/14_interest_and_apys.md`](../subsystems/14_interest_and_apys.md) (full)
- [`../subsystems/15_threat_model.md`](../subsystems/15_threat_model.md) §11 (invariants)
- [`../subsystems/16_performance.md`](../subsystems/16_performance.md) (SLOs)

### External services / APIs
- None new.

### External reference docs
- k6 load testing: <https://k6.io/docs/>

### Goals
1. Run the full S15 §11 invariant test suite — must be 100% green.
2. Verify S14 APY math against a reference simulation (Python notebook).
3. Run k6 load tests against the API server — meet S16 SLOs (p95 ≤ 7 min op latency, p95 ≤ 30 s subgraph lag).
4. Run the full `system_check.md` integration suite.
5. Compile a release-candidate report: scope completed, scope deferred, known issues.

### How to achieve
1. Most invariant tests are already authored Day 1-20; today's job is to run them as a single CI matrix.
2. APY simulation: drive synthetic supply + borrow + accrue events; compare on-chain index to off-chain reference.
3. k6 scripts: ramp users; measure latency distributions.

### Done when
- [ ] All invariant tests green.
- [ ] APY reference simulation matches on-chain within 1 wei rounding tolerance.
- [ ] S16 SLOs met on testnet load.
- [ ] `system_check.md` full suite green.
- [ ] Release-candidate report committed to `code/docs/rc-day-21.md`.

### Tests
Run section **Day-21** in `subsystem_test.md` and the full `system_check.md`.

---

## What's NOT in the 21 days (deferred to pre-mainnet hardening)

Per `project_overview.md` §5, the following are out of v1 scope and
therefore out of the 21-day roadmap:

- Mainnet deploy (waits for Horizen VELA mainnet)
- Direct on-chain ZK verification tier ("premium" / "instant") — v1.5
- Auditor portal as separate app — v1.5
- Mobile-native iOS / Android — v1.5
- 5 additional UI languages — v1.1
- Self-aggregating chain — v1.1

These appear in the post-21 backlog after audit completion.

---

## Daily wrap-up format (per `agent_workflow_rules.md` Rule 4)

At end of each day, the agent reports to the user:

```
🎯 Day N complete.
Today's deliverables: <list>.
🧪 Tests run: <pass/fail/skipped list>.
🔔 Decisions made: <list with verbatim user inputs from progress_tracker.md>.
🔌 External services accessed: <list>.
🚧 Outstanding from today's scope: <list, if any>.
What's next?
```

The agent then **waits** for the user's go-ahead before starting Day N+1.

---

## Cross-references

- Implementation rules: [`agent_workflow_rules.md`](agent_workflow_rules.md)
- Coding standards: [`code_standard.md`](code_standard.md)
- Tech stack + boundaries: [`architecture_context.md`](architecture_context.md)
- Project goals: [`project_overview.md`](project_overview.md)
- Subsystem composition: [`connections.md`](connections.md)
- Per-day tests: [`subsystem_test.md`](subsystem_test.md)
- Group-level tests: [`system_check.md`](system_check.md)
- Living checklist: [`progress_tracker.md`](progress_tracker.md)
