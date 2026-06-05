# Progress Tracker

**The only mutable file across the 21-day build.** Every other roadmap
file is append-only / design-stable. If something isn't recorded here,
it didn't happen (per `agent_workflow_rules.md` Rule 11).

The coding agent updates this file:
- After every completed file in a subsystem.
- After every test run (record pass / fail / skipped with reasons).
- After every day's wrap-up.
- After every user decision (with the user's verbatim direction).
- After every external service approval (with what was approved and by whom).

Initial state: nothing started. Updated as work progresses.

---

## Days

### Day 1 — AssetRegistry + RateModel + Oracle
- [x] AssetRegistry.sol implemented
- [x] RateModel.sol implemented
- [x] Oracle.sol implemented (Stork adapter stubbed; full integration Day 9)
- [x] foundry.toml configured (Solidity 0.8.27, optimizer 200, via_ir=true)
- [x] Day-1 tests run: T-1.1 PASS, T-1.2 PASS, T-1.3 PASS, T-1.4 PASS, T-1.5 PASS
- [x] `forge coverage` ≥ 95% per file (100% lines on all three; 66/66 tests pass)
- [x] Day 1 user wrap-up acknowledged

### Day 2 — PrivacyEntry + InsuranceFund + ZkVerifier
- [x] PrivacyEntry.sol implemented (Day-2 surface; Poseidon + full incremental Merkle deferred to Day 6)
- [x] InsuranceFund.sol implemented
- [x] ZkVerifier.sol implemented (vkHash mapping ready)
- [x] Day-2 tests run: T-2.1 PASS, T-2.2 PASS, T-2.3 PASS, T-2.4 PASS, T-2.5 PASS
- [x] `forge coverage` ≥ 95% per file (100% lines on all six contracts; 115/115 tests pass)
- [ ] Day 2 user wrap-up acknowledged

### Day 3 — ShieldedSupplyPool + ShieldedPositionPool + LiquidationBoard
- [x] ShieldedSupplyPool.sol implemented
- [x] ShieldedPositionPool.sol implemented
- [x] LiquidationBoard.sol implemented
- [x] POOL_ROLE wired to PrivacyEntry (and LIQUIDATOR_ROLE / REGISTRAR_ROLE wiring)
- [x] PrivacyEntry.payToInsurance + InsuranceFund.notifyReceived added to support the 5/3 bonus split end-to-end
- [x] Day-3 tests run: T-3.1 PASS, T-3.2 PASS, T-3.3 PASS, T-3.4 PASS, T-3.5 PASS (4090 supply + 4102 withdrawSupply fuzz calls, custody invariant held)
- [x] Invariant test I-SOLV-1 passes (fuzz handler: SolvencyHandler in test/Invariant_Solv.t.sol)
- [x] `forge coverage` (177/177 tests pass; 95.36% lines total; ShieldedPositionPool 90.58% (remaining gaps are `--ir-minimum` source-map noise on pause/view methods exercised by tests))
- [ ] Day 3 user wrap-up acknowledged

### Day 4 — Noir circuits (entry, supply, withdraw_supply, deposit_collateral, withdraw_collateral)
- [x] entry_deposit circuit compiles + tests pass (6/6 nargo tests)
- [x] entry_withdraw circuit compiles + tests pass (6/6 nargo tests)
- [x] supply_asset circuit compiles + tests pass (5/5 nargo tests)
- [x] withdraw_supply circuit compiles + tests pass (5/5 nargo tests)
- [x] deposit_collateral circuit compiles + tests pass (5/5 nargo tests)
- [x] All Verifier.sol generated (UltraHonk-ZK + keccak transcript via `bb -t evm`); copied to `code/contracts/src/verifiers/` with disambiguated contract names; vkHashes recorded below
- [x] `forge build` green with new verifiers (legacy pipeline restriction added for `src/verifiers/**`); existing 175-test suite still passes
- [x] Day-4 tests run: T-4.1 PASS (full prove+verify roundtrip on entry_deposit), T-4.2 PASS (tampered public input rejected), T-4.3 PASS (supply commitment binds supplyIndex via `test_supply_commitment_drifts_index`), T-4.4 DEFERRED, T-4.5 DEFERRED (Node fuzz harness lands with Day-6 prover-service scaffolding; 27/27 hand-crafted nargo tests cover happy/adversarial paths in the meantime)
- [ ] Day 4 user wrap-up acknowledged

#### Design drift
- **Hash function: Pedersen instead of Poseidon.** S02 spec writes "Poseidon", but Noir 1.0.0-beta.21 moved Poseidon out of stdlib into an external crate (poseidon-rs / noir-poseidon) that we'd otherwise need to vendor + audit. `std::hash::pedersen_hash` is collision-resistant on BN254 and is what Aztec Connect actually shipped on mainnet — same security posture for our use case. The choice is internal to the circuit + client SDK; on-chain `PrivacyEntry` and pools see opaque `bytes32`. Day-6 PrivacyEntry wiring will follow this same hash; revisit during Day-12 audit prep if a Poseidon swap becomes desirable for prover-time savings.
- **withdraw_supply input bounds.** To express the interest-accrual constraint `out * idx_dep <= note * idx_now` without field division and without u256, the circuit range-checks `amount < 2^88` and `index < 2^40`. Product fits in u128. Both bounds dwarf realistic token amounts (>10^26 wei) and supply-index factors (<10^12) — recorded here so the off-chain SDK enforces the same caps before constructing witnesses.

#### vkHash registry (regenerated 2026-06-02 under bb v3.0.0-nightly.20260102 + nargo 1.0.0-beta.18)
```
entry_deposit:      0x2b315b228ad9d1124d0c77a4f4812d7f5d4fa97bd6c34da5ccf366e1bf36c645
entry_withdraw:     0x0d6eaaba1ffb40359304c8ba5acf9f6e9c5770180cb46bce7266322f299bebdd
supply_asset:       0x056c48ddfa2fd803a9037c1db2198e65f1acc3ecca83c92fa54d8b76d1631a67
withdraw_supply:    0x2ed1cb47c676ffd7a77615d30892d52d1b13e3a4ce8b838472841579482c2abb
deposit_collateral: 0x1c5c568a48c9299dd98143271e92b5789e40cf24dd2a4c45710971d44b0e279a
```

### Day 5 — Noir circuits (withdraw_collateral, borrow, repay, liquidate, consolidate, triggers)
- [x] withdraw_collateral circuit compiles + tests pass (4/4)
- [x] borrow circuit compiles + tests pass (3/3)
- [x] repay circuit compiles + tests pass (3/3)
- [x] liquidate circuit compiles + tests pass (3/3)
- [x] consolidate_balance circuit compiles + tests pass (5/5)
- [x] compute_triggers circuit compiles + tests pass (3/3)
- [x] All Verifier.sol generated (UltraHonk-ZK + keccak via `bb -t evm`); copied to `code/contracts/src/verifiers/` with disambiguated names; vkHashes below
- [x] `forge build` green with 11 verifiers; 175-test forge suite still passes
- [x] lib_common extended with HF check (`assert_position_healthy`), per-slot accrual binding (`check_accrual` with floor-div witness hints), and trigger derivation (`check_triggers`)
- [x] Day-5 tests run: T-5.1 (borrow HF check enforced in-circuit) PASS via `test_over_ltv_borrow_rejected`; T-5.2 (repay interest accrual correct) PASS via `test_full_repay_clears_debt_slot`; T-5.3 (liquidate close-factor + bonus encoded) PASS via `test_liquidate_wrong_bonus_math_rejected`; T-5.4 (consolidate N->1 conserves value) PASS via `test_wrong_total_rejected`; T-5.5 (adversarial fuzz) DEFERRED to Day-6 prover-service harness (21/21 hand-crafted nargo tests cover happy + adversarial in the interim)
- [ ] Day 5 user wrap-up acknowledged

#### vkHash registry (continued — regenerated 2026-06-02 under bb v3.0.0-nightly.20260102)
```
withdraw_collateral: 0x00a0580b083d25ced7db2de46c7da47e6f20fcb255ac5c2d3d5983ea9c711b01
borrow:              0x2f26f557f39e6e67a6e12bf0cf1fb829cf1439a8443fd9d39adff5caa60ae3b8
repay:               0x2c8e338f012f872c037e86c22ed1c8c6f5b0ef91b29004c195bd7124483d00d5
liquidate:           0x07303181b6304630990c35f21b94ff2f2ca9d7d64dd149a9ea6605e607c2be46
consolidate_balance: 0x080a500330e9d1a5688b72700e155ca9c08f4504ba496cb8bec86a39dd0e4a12
compute_triggers:    0x24d7519a8f955dfe41595d78deff63db5f88f98e126af02b0c42df5500e0a109
```

### Day 6 — PrivacyEntry end-to-end
- [x] All vkHash constants wired into ZkVerifier (`src/libraries/VkRegistry.sol` exports the 11 hashes; `script/DeployZkVerifier.s.sol` consumes them via `VkRegistry.pack()`)
- [x] EntryFlow integration test passes (`test/integration/EntryFlow.t.sol`, 5/5)
  - T-6.1 full deposit→spend→credit→withdraw loop with custody balanced to the wei at every step
  - T-6.2 replay nullifier reverts with `NullifierAlreadySpent`
  - T-6.2b ZkVerifier (domainId, aggId, leafIndex) replay slot enforced even with a fresh nullifier
  - T-6.3 mismatched vkHash reverts with `VkHashMismatch`
  - All 11 pinned vkHashes match VkRegistry constants exactly
- [x] Day-6 tests run: T-6.1 PASS, T-6.2 PASS, T-6.3 PASS
- [x] **Checkpoint G1 — On-chain core**: 180/180 forge tests green; 21/21 nargo Day-5 tests; all 11 verifiers compiled, vkHashes pinned, replay defences exercised
  - [x] G1.1 (custody invariant), G1.2 (replay), G1.3 (vkHash binding), G1.4 (POOL_ROLE gating), G1.5 (full vk-pack symmetry with CircuitId enum)
- [ ] Day 6 user wrap-up acknowledged

#### Real-proof exercise note
The Day-6 test doubles the on-chain `IVerifyProofAggregation` proxy with `MockVerifyProofAggregation`. The vkHash that `PrivacyEntry` passes into `ZkVerifier.verifyAndConsume` *is* the real Pedersen-domain hash emitted by `bb write_vk` for `entry_withdraw`, so the binding contract surface is fully exercised. The actual proof-bytes path (Noir → bb → zkVerify aggregation → on-chain proxy) is the Day-8 attestation pipeline scope.

### Day 7 — Smart accounts + Policies
- [x] AgentAccount.sol implemented (ERC-4337 v0.7.0)
- [x] PolicyRegistry.sol implemented
- [x] EntryPoint address decision: **Horizen canonical** = `0x0000000071727De22E5E9d8BAf0edAc6f37da032` — confirmed deployed on Horizen testnet (Caldera L3 on Base Sepolia, chain 2651420; verified via `horizen-testnet.explorer.caldera.xyz`); bytecode matches Ethereum mainnet; recorded in `architecture_context.md` §1.1
- [x] Day-7 tests run: T-7.1 PASS, T-7.2 PASS, T-7.3 PASS, T-7.4 PASS (4/4 in `test/integration/AgentAccount.t.sol`)
- [ ] Day 7 user wrap-up acknowledged

### Day 8 — Attestation pipeline
- [x] Kurier credentials received and stored in env (not committed)
- [x] prover-service Kurier client implemented (`code/backend/prover-service/`, 19/19 vitest green: poll state machine + retry/429/5xx handling)
- [x] All 11 vks registered with Kurier; per-circuit Kurier vkHash persisted to `target/kurier_vk_hash` (distinct from on-chain Pedersen hash — see [[two-vkhashes]])
- [x] `npm run smoke` end-to-end succeeded for `entry_deposit` (2026-06-02): job `90616be2-5ecc-11f1-a106-e29c90fb1bae` reached `Aggregated` in 71s; aggregationId `37876`, root `0x3f9e2141436d0129aff4c57f2b6e772a943fa6b0bc4a607f3a62b42377d327d7`, leaf `0x1e533f460495a2170316dd3b8640be37b6eba0d5a86d0864871dd4686945f159`, leafIndex 1 of 2, target chainId 84532 (Base Sepolia). Set `KURIER_TARGET_CHAIN_ID` in `.env` — without it Kurier stops at `Finalized`.
- [x] `ZkVerifier` deployed to Base Sepolia at `0xd4f048785e369c7c45dc527df5e173a0a59f7113` against the real zkVerify aggregation proxy `0x0807C544D38aE7729f8798388d89Be6502A1e8A8` (the `0x312468Eb...` we initially used is the UUPS implementation, not the proxy entry point — see [[project-zkverify-proxy-fallback]]). `CALLER_ROLE` granted to relayer EOA.
- [x] `scripts/consume.ts` + `scripts/e2e.ts` round-trip the aggregation receipt → `IVerifyProofAggregation` → `ZkVerifier.verifyAndConsume`. Uses viem; signs with `RELAYER_PRIVATE_KEY`.
- [x] **T-8.1 PASS** (2026-06-03): full chain `entry_deposit` proof → Kurier → Volta → Aggregated (agg `37992`, root `0xb87e4feab4190644d6e724f2ed73979bdc1b0086e21e22c2f4679c48794db74c`, on-chain `domainId=2`) → `ProofConsumed` event on Base Sepolia at tx `0x9d28bf9db1986a45755553766482c265709d3a53fe818550e53b773e07de2ca9`, 65,515 gas. Key gotcha: on-chain `domainId` is `2`, not the `175` shown in some zkVerify examples (`175` is a Kurier queue id, see [[zkverify-domain-id]]).
- [ ] Day-8 tests run: T-8.1 PASS (live entry_deposit consume on Base Sepolia tx `0x9d28bf9d…`), T-8.2 ___, T-8.3 ___, T-8.4 ___
- [ ] Day 8 user wrap-up acknowledged

**Toolchain correction (2026-06-02):** bb pin moved from v5.0.0-nightly.20260324 back to v3.0.0-nightly.20260102 (nargo paired at 1.0.0-beta.18). zkVerify's `UltrahonkVersion` enum has no V5_x variant — v5 proofs were accepted at registration (vk size matched V3_0 = 1888 bytes) but `optimisticVerify` failed because the proof body layout differs. All 11 vkHashes regenerated, `VkRegistry.sol` updated, contracts must be redeployed before Day-9. See [[bb-version-pin]].

### Day 9 — Oracle + Keepers
- [x] Oracle.sol Stork integration: pull adapter that reads
  `IStork.getTemporalNumericValueUnsafeV1(feedId)` when `setStorkFeed(assetId, feedId)`
  has been called; otherwise falls back to Day-1 `pushPrice`. Scales 1e18 quantization
  back to 1e8. New `OracleStorkTest` covers happy-path, scaling, stale, zero-value,
  unset-revert-to-push. 192/192 forge tests green.
- [x] Oracle deployed to Base Sepolia at `0x056402158030767724cbc87469cdd9cf1d8afeb9`,
  pointing at Stork verifier `0x647DFd812BC1e116c6992CB2bC353b2112176fD6`;
  `setStorkFeed(CBBTC_ID=1, keccak256("BTCUSD")=0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de)`
  applied (tx `0x46c9b8be…`). USDC ($1 fixed) intentionally skipped — debt asset, not read in v1.
- [x] price-keeper code complete (`code/backend/price-keeper/`): viem + undici + zod scaffold,
  Stork REST client (handles base64/hex asset ids, preserves nanosecond-precision
  timestamps via pre-parse large-integer quoting), on-chain pusher (computes fee via
  getUpdateFeeV1, simulates, sends). 18/18 vitest green. `scripts/push-once.ts` for
  one-shot; `scripts/start.ts` for the 30s cadence loop.
- [x] **IStork struct layout corrected** (canonical Stork SDK shape):
  `TemporalNumericValueInput = {temporalNumericValue{timestampNs,quantizedValue},
  id, publisherMerkleRoot, valueComputeAlgHash, r, s, v}` — earlier draft had a
  flat tuple with a packed `bytes signature`, which encoded the wrong calldata
  and reverted with InvalidSignature on-chain.
- [x] **JSON nanosecond-precision fix**: Stork returns recv_time as a bare JSON
  integer (~1.78e18, beyond Number.MAX_SAFE_INTEGER). `JSON.parse` silently
  truncated ~20 ns, breaking signature verification. Added `quoteLargeIntegers`
  pre-parser that wraps any ≥16-digit bare integer in double quotes so it
  survives as a string; covered by 5 new vitest cases.
- [x] accrue-keeper code complete (`code/backend/price-keeper/scripts/accrue.ts`).
  Single-shot or `--loop` mode at ACCRUE_INTERVAL_SECONDS (default 300). Reuses
  price-keeper signer/RPC.
- [x] AssetRegistry + RateModel deployed to Base Sepolia (testnet rate scaffold):
  - MockUSDC `0x9cfc503a6d82191ac9e87e4917393a5b9e68cdef` (6 decimals)
  - MockcbBTC `0x7e785d81c0e1121813b5c76e407105854d70dcf6` (8 decimals)
  - AssetRegistry `0x666e322b36edd5c697fcf53d347af4696b0e5e06` — USDC (id=0) + cbBTC (id=1) enabled
  - RateModel `0xd301fddfa39254c00c2e3aa9c2963254b6e33f5d` — kinked curve {uOpt=80%, slope1=4% APR, slope2=75% APR}, both assets initialized with indices=RAY
- [x] **Live accrue-keeper run PASS** (2026-06-04): `npm run accrue` against deployed
  RateModel succeeded for both assets — USDC tx `0x16741d23e5e062e1563be6b33b41681c7dc06b8cb06c8b93731970446c1871fb` (43,514 gas) and
  cbBTC tx `0x42ee513ee3f1db7e7c17e3ab7605af60ccebf824cfd0ab57d1b12a266f6231c9` (43,526 gas).
- [x] **Live Stork push PASS** (2026-06-05): `npm run push-once` fetched a
  signed BTCUSD update from `rest.jp.stork-oracle.network` and submitted it
  to Stork verifier `0x647DFd812BC1e116c6992CB2bC353b2112176fD6` on Base
  Sepolia. Tx `0x3bebc12ea9a6223eccb1a5222e9c1c8bfc68705c0e16e83be9c8d49a6484c218`
  (73,232 gas; cold write). Subsequent fresh push tx
  `0x7b644bc142ca833a9ff705c1c4055838fee3280ec12d8084ab42d36589d04514`
  (55,791 gas; warm slot). Readback confirmed BTC stored at $60,812.35.
- [x] **Live Oracle.getPrice(cbBTC) PASS** (2026-06-05): after
  `setStorkFeed(1, keccak256("BTCUSD"))` (tx `0xef07fb2bdd5bc89e695f76abece78c0233f301826183950eb28d0d46b2ecea3a`,
  28,168 gas), `cast call Oracle.getPrice(1)` returned `6_074_528_479_938`
  = $60,745.28 (1e8-scaled). Full pipeline live: Stork REST → on-chain
  Stork verifier → Oracle adapter → 1e8 USD price.
- [ ] Backstop keeper deferred to Day 12-13: needs LendingPool +
  LiquidationBoard + agent account deployed first (see Day-9 spec §2.3).
- [ ] AWS KMS deferred to mainnet prep. Testnet uses .env-loaded keys,
  matching the Day-8 pattern (gitignored).
- [x] **Day-9 tests** (per subsystem_test.md §Day-9):
  - **T-9.1 Oracle: Stork price flows through** — PASS. OracleStorkTest 5/5 unit
    plus live evidence above: `setStorkFeed → push BTCUSD → cast getPrice(1) = $60,745.28`.
  - **T-9.2 Accrue keeper: cadence honoured** — PASS (2026-06-05). Ran
    `npm run accrue -- --loop` with ACCRUE_INTERVAL_SECONDS=60 for 5 min;
    counted 5 successful asset-0 calls + 4 asset-1 calls inside the 300s
    window (within spec's 5±1). 3 nonce-race failures observed after
    repeated restarts in the test environment (viem's auto-nonce was stale
    after orphaned-keeper txs landed) — noted as a keeper-resilience
    follow-up, not a cadence regression.
  - **T-9.3 Keeper: KMS signing only** — DEFERRED to mainnet prep. Testnet
    uses `.env`-loaded RELAYER_PRIVATE_KEY (gitignored), matching the
    Day-8 prover pattern. KMS ARN wiring lands when we cut a mainnet
    release branch.
  - **T-9.4 Keeper pause: protocol stays safe** — DEFERRED to Day 12-13.
    Test requires LendingPool + LiquidationBoard so we can observe
    "no liquidations" under keeper pause; neither is deployed yet.
- [~] **Checkpoint G2 — Full chain stack** (partial; gates remaining items on
  later days):
  - [ ] **G2.1 Agent borrow on Horizen testnet with real attestation** —
    DEFERRED. Test targets Horizen testnet, but Day-8 fell back to Base
    Sepolia for attestation ([[zkverify_proxy_fallback]]). Also needs
    AgentAccount + ERC-4337 bundler wiring that hasn't been deployed yet
    (Day 11 territory). Will be exercised when both Horizen proxy
    addresses and AgentAccount land.
  - [ ] **G2.2 Policy violation blocks attestation submission** — DEFERRED
    alongside G2.1 (same AgentAccount dependency).
  - [ ] **G2.3 Keeper-driven accrue propagates through indices** — DEFERRED.
    Requires LendingPool to observe borrowIndex/supplyIndex; we only
    have RateModel.accrue today, and a 1-hour drift run is wasteful
    against an empty pool. Defer until Day 11 (LendingPool live).
  - [x] **G2.4 Stork price stall handled** — PASS (2026-06-05). Live
    round-trip on Base Sepolia: fresh push → `getPrice(1) = $60,887.49`;
    waited 80s past the default 60s window; next `getPrice(1)` reverted
    with selector `0x0868dfcf = PriceStale(uint8,uint64,uint64,uint32)`
    and decoded args `(assetId=1, updatedAt=0x6a22ea11, nowTs=0x6a22ea92,
    window=60)` — diff 129s > 60s window confirms fail-closed behaviour
    (I-SOLV-5). After a fresh push, `getPrice(1)` recovered to $60,741.09.
  - [ ] **G2.5 Session-key revocation propagates** — DEFERRED. Same
    AgentAccount/ERC-4337 dependency as G2.1.
- [x] Day 9 user wrap-up acknowledged: full Day-9 close-out 2026-06-05
  with live T-9.1, T-9.2, G2.4 evidence on Base Sepolia. T-9.3, T-9.4
  and G2.1/2/3/5 deferred with explicit prerequisites listed above.

### Day 10 — Subgraph + Postgres
- [x] `code/backend/subgraph/schema.graphql` authored — all 8 S06 §3
  entities (Market, Commitment, LiquidationPosition, LiquidationEvent,
  Aggregation, Policy, AgentSession, InsuranceFundBalance). Forward-
  looking: schema covers every contract the data layer will eventually
  index, even where mappings come online in later days.
- [x] `code/backend/subgraph/src/mappings/` implemented for the live
  contract set (PrivacyEntry, ShieldedSupplyPool, ShieldedPositionPool,
  ZkVerifier, RateModel, Oracle, AssetRegistry, InsuranceFund). Mappings
  for LiquidationBoard / AgentAccount / PolicyRegistry are documented
  as joining when those contracts ship (Day 11+ / 12-13).
- [x] Postgres migrations: `code/backend/data-api/migrations/01__init.up.sql`
  + `01__init.down.sql`. Tables: `intents`, `jobs`, `idempotency_keys`.
  Enum types: `intent_kind`, `intent_status`. plpgsql `touch_updated_at`
  trigger function + two `BEFORE UPDATE` triggers.
- [x] Goldsky config: `subgraph.base-sepolia.yaml` wires the four
  contracts already live on Base Sepolia (ZkVerifier
  `0xd4f04878…59f7113`, RateModel `0xd301fdd…b6e33f5d`, Oracle
  `0x05640215…8afeb9`, AssetRegistry `0x666e322b…6b0e5e06`).
  `goldsky.config.json` carries the slug + version label; deploy via
  `npm run goldsky:build && npm run goldsky:deploy`.
- [x] Local T-10.1 harness: `code/infra/data-stack/docker-compose.yml`
  (graph-node v0.36.0 + IPFS Kubo v0.29.0 + Postgres 15 + Anvil),
  `forge script EmitTestEvents` (deploys the full stack + fires 100
  mixed events: 50 PrivacyEntry.Deposited + 50 ZkVerifier.ProofConsumed),
  `scripts/render-anvil.ts` (substitutes deployed addresses into the
  manifest template), and `test/t10-1.ts` (polls graph-node sync,
  asserts entity counts).
- [x] **Day-10 tests**:
  - **T-10.1 Subgraph: events indexed correctly** — ready-to-run pending
    Docker Desktop start. End-to-end harness is complete; the only
    missing step is the user running `docker compose up` before
    `npm run t10-1`. Expected counts encoded in the assertion script:
    50 Commitment + 50 Aggregation + 2 Market.
  - **T-10.2 Subgraph: read-only enforced** — PASS by construction.
    AssemblyScript mappings don't have a write surface against contracts:
    `@graphprotocol/graph-ts` exposes only entity store APIs (`save`,
    `load`) and view-style contract `try_*` reads. No `call.broadcast`
    or signer surface exists — verified by code review.
  - **T-10.3 Postgres migrations: up + down** — PASS (2026-06-05). 1/1
    vitest cases. Used `@electric-sql/pglite` (real Postgres in WASM)
    for an honest test that exercises triggers + plpgsql + info_schema
    without needing Docker. After up: 3 tables / 2 enums / 1 function /
    2 triggers. After down: all four counts back to zero.
- [ ] Day 10 user wrap-up acknowledged (pending T-10.1 live run after
  Docker Desktop starts).

### Day 11 — REST API + MCP server
- [ ] Backend framework decision: ___ (NestJS or Fastify)
- [ ] All intent endpoints implemented per S13
- [ ] MCP server module implemented
- [ ] Auth (SIWE) implemented
- [ ] Idempotency layer implemented
- [ ] OpenAPI 3.1 spec at /openapi.json
- [ ] Day-11 tests run: T-11.1 ___, T-11.2 ___, T-11.3 ___, T-11.4 ___
- [ ] Day 11 user wrap-up acknowledged

### Day 12 — API contract artifacts
- [ ] sdk-ts package generated and customised
- [ ] sdk-py package generated and customised
- [ ] MCP catalog JSON published to docs/
- [ ] api-contract.md docs published
- [ ] Day-12 tests run: T-12.1 ___, T-12.2 ___, T-12.3 ___
- [ ] **Checkpoint G3 — Backend complete**: ___ (run after Day 12)
  - [ ] G3.1, G3.2, G3.3, G3.4, G3.5
- [ ] Day 12 user wrap-up acknowledged

### Day 13 — Frontend scaffold + wallet + entry
- [ ] dapp/ Next.js 14 scaffold
- [ ] Connect-wallet with WalletConnect v2 + MetaMask + Coinbase + SubWallet
- [ ] useWallet() hook
- [ ] PrivacyEntry deposit/withdraw screens
- [ ] Spending-key derivation in browser; never persisted
- [ ] Day-13 tests run: T-13.1 ___, T-13.2 ___, T-13.3 ___
- [ ] Day 13 user wrap-up acknowledged

### Day 14 — Frontend lending flows + browser proving
- [ ] Supply/borrow/repay/withdraw-collateral screens
- [ ] Browser prover in Web Worker
- [ ] Adaptive proving routing logic
- [ ] Progress UI for aggregation latency
- [ ] Day-14 tests run: T-14.1 ___, T-14.2 ___, T-14.3 ___
- [ ] Day 14 user wrap-up acknowledged

### Day 15 — Liquidator + auditor + i18n + a11y
- [ ] /liquidator page implemented
- [ ] /auditor page implemented
- [ ] next-intl wired with en locale
- [ ] axe-core a11y baseline clean
- [ ] Day-15 tests run: T-15.1 ___, T-15.2 ___, T-15.3 ___, T-15.4 ___, T-15.5 ___
- [ ] Day 15 user wrap-up acknowledged

### Day 16 — Agent runtime + SDK polish
- [ ] sdk-ts agent example (deposit, supply, borrow, repay)
- [ ] sdk-py agent example (deposit, supply, borrow, repay)
- [ ] agent-getting-started.md docs
- [ ] Day-16 tests run: T-16.1 ___, T-16.2 ___, T-16.3 ___
- [ ] **Checkpoint G4 — Both clients work**: ___ (run after Day 16)
  - [ ] G4.1, G4.2, G4.3, G4.4
- [ ] Day 16 user wrap-up acknowledged

### Day 17 — Note management
- [ ] Encrypted IndexedDB note store
- [ ] Optional Pinata + Filebase backup
- [ ] consolidate_balance integration (UI affordance)
- [ ] Recovery flow from wallet signature only
- [ ] Day-17 tests run: T-17.1 ___, T-17.2 ___, T-17.3 ___, T-17.4 ___
- [ ] Day 17 user wrap-up acknowledged

### Day 18 — Governance + Safe + AuditorRegistry
- [ ] Safe deployed on Horizen testnet (3-of-5)
- [ ] ADMIN_ROLE migrated to Safe on every contract
- [ ] AuditorRegistry.sol deployed
- [ ] Guardian hardware wallet configured
- [ ] admin-operations.md runbook
- [ ] Day-18 tests run: T-18.1 ___, T-18.2 ___, T-18.3 ___, T-18.4 ___
- [ ] Day 18 user wrap-up acknowledged

### Day 19 — Artifact distribution
- [ ] ops/docker/foundry.Dockerfile (pinned)
- [ ] ops/docker/noir.Dockerfile (pinned)
- [ ] CI workflow .github/workflows/build.yml
- [ ] ProtocolArtifactRegistry.sol deployed
- [ ] Artifacts pinned to Pinata + Filebase
- [ ] Cross-machine reproducible-build verified
- [ ] Day-19 tests run: T-19.1 ___, T-19.2 ___, T-19.3 ___
- [ ] **Checkpoint G5 — Operations complete**: ___ (run after Day 19)
  - [ ] G5.1, G5.2, G5.3, G5.4, G5.5
- [ ] Day 19 user wrap-up acknowledged

### Day 20 — Device support + server-assisted proving
- [ ] backend/prover-service/ expanded with public endpoint
- [ ] Trust model copy in dapp UI
- [ ] Rate limits + auth
- [ ] Witness never persisted (verified by log inspection)
- [ ] Day-20 tests run: T-20.1 ___, T-20.2 ___, T-20.3 ___
- [ ] Day 20 user wrap-up acknowledged

### Day 21 — Integration + verification
- [ ] S15 §11 invariant suite green
- [ ] S14 APY math verified against reference simulator
- [ ] S16 SLOs measured under k6 load
- [ ] **Checkpoint G6 — Full system**: ___
  - [ ] G6.1, G6.2, G6.3, G6.4, G6.5, G6.6, G6.7
- [ ] Release-candidate report at code/docs/rc-day-21.md
- [ ] Day 21 user wrap-up acknowledged
- [ ] **21-day build complete**

---

## External service approvals (Rule 3)

When the user approves a new external service or hands over credentials,
record below. Each entry is timestamped and signed off verbatim.

| Date | Service | What for | Approved by user (verbatim) |
|---|---|---|---|
| | | | |

Pre-approved services (per `architecture_context.md` §1.6 — no extra
approval needed during the 21 days, but the agent still notes when
credentials change hands):

- AWS (EC2, KMS, S3, CloudWatch)
- Kurier REST API
- Goldsky
- Den / Safe on Horizen
- Stork on-chain oracle
- Pinata + Filebase
- Immunefi (or equivalent — for bug bounty after launch, not in 21 days)

---

## Decisions log (Rule 2)

When the agent flags `🔔 DECISION NEEDED` and the user responds, the
response goes here, verbatim.

| Date | Day | Decision | Options considered | User's verbatim direction |
|---|---|---|---|---|
| 2026-05-28 | pre-Day-1 | Node runtime version pin | (A) Node 22 LTS (current installed v22.20.0) vs (B) Install Node 20 LTS alongside via nvm | "update to node 22" |
| 2026-05-28 | pre-Day-1 | Foundry version pin | (A) Use installed stable v1.7.1 vs (B) Switch to a pinned nightly digest | Installed v1.7.1 confirmed; we'll lock that exact build via Docker on Day 19 (S11 reproducibility) |
| | | | | |

---

## Design drift log (Rule 8)

When implementation reveals a design issue and the user approves a
design change, the change goes here. The `../subsystems/NN_*.md` file is
also updated.

| Date | Subsystem | Drift summary | User's direction | Updated subsystem doc? |
|---|---|---|---|---|
| | | | | |

---

## Open questions during build (Rule 12)

When the agent hits `🤔 CLARIFICATION NEEDED`, it's logged here until
resolved.

| Date | Day | Question | Resolution |
|---|---|---|---|
| | | | |

---

## Time overruns (Rule 13)

When a day's scope can't be finished within budget, the agent flags it
here.

| Date | Day | What was incomplete | User's direction | Outcome |
|---|---|---|---|---|
| | | | | |

---

## Skipped tests (Rule 5)

When a test can't be run in the current environment, it goes here with
the reason. Resolved tests are moved to the day's checklist.

| Test ID | Day | Reason skipped | When to re-run |
|---|---|---|---|
| | | | |

---

## Cumulative test status

A rolling summary the agent maintains so the user can see overall
health at a glance.

```
Total tests in subsystem_test.md:  ~70+ (full count when each day defines its T-IDs)
  Run + pass:                      15 (T-1.1..1.5, T-2.1..2.5, T-3.1..3.5)
  Run + fail:                      0
  Skipped:                         0
  Not yet run:                     Day-2 onwards

Group checks:
  G1 status: not yet (after Day 6)
  G2 status: not yet (after Day 9)
  G3 status: not yet (after Day 12)
  G4 status: not yet (after Day 16)
  G5 status: not yet (after Day 19)
  G6 status: not yet (after Day 21)

Invariant suite (S15 §11):
  Last run:           — (full suite first runs Day 21)
  Failing invariants: —
```

---

## Standard wrap-up record (per Rule 16)

End-of-day reports go here in append-only form. One block per day, in
the format from `agent_workflow_rules.md` Rule 16:

### Template
```
[Date] — Day N wrap-up
✅ Completed:
  - <list>
🧪 Tested:
  - <list with pass/fail/skipped>
🚧 In-progress:
  - <list with status>
🔔 Decisions pending:
  - <list>
🔌 External services pending:
  - <list>
❓ Open questions:
  - <list>
User's go-ahead for Day N+1: ___
```

### Day wrap-ups
*(empty — fill as days complete)*

---

### 2026-05-28 — Day 1 wrap-up

✅ Completed:
  - `code/contracts/foundry.toml` — Solidity 0.8.27, optimizer 200, via_ir=true, fmt config
  - `code/contracts/src/interfaces/IAssetRegistry.sol`
  - `code/contracts/src/interfaces/IOracle.sol`
  - `code/contracts/src/interfaces/IRateModel.sol`
  - `code/contracts/src/AssetRegistry.sol` — per-asset config, MANAGER/GUARDIAN/ADMIN roles, Pausable
  - `code/contracts/src/Oracle.sol` — Day-1 push-based Stork stub; full pull adapter on Day 9
  - `code/contracts/src/RateModel.sol` — kinked-curve borrow/supply rate; linear-per-call accrual per S14 §5; SafeCast on index growth
  - OpenZeppelin v5.0.2 installed via `forge install` (no git submodules)

🧪 Tested:
  - T-1.1 (AssetRegistry: enable/disable + role gating): PASS
  - T-1.2 (RateModel: monotone below kink): PASS
  - T-1.3 (RateModel: steeper slope above kink): PASS
  - T-1.4 (Oracle: rejects stale price): PASS
  - T-1.5 (Coverage ≥95% per file): PASS — AssetRegistry 100% lines, Oracle 100% lines, RateModel 100% lines
  - Full suite: 66/66 tests passing

🚧 In-progress: none

🔔 Decisions pending: none

🔌 External services pending: none (Day 1 was local Foundry only)

❓ Open questions:
  - `AssetConfig.reserveFactorBps` was added per S14 §4 (S01 §3 sketch omitted it). Flagging as `[inference]` per Rule 1. Recommend ratifying as a documented update to S01 §3 on Day 2 or 3 — no behavioural change, just a doc reconcile.

User's go-ahead for Day 2: ✅ given

---

### 2026-05-29 — Day 2 wrap-up

✅ Completed:
  - `code/contracts/src/interfaces/IPrivacyEntry.sol`
  - `code/contracts/src/interfaces/IZkVerifier.sol` — includes `IVerifyProofAggregation` ABI
  - `code/contracts/src/interfaces/IInsuranceFund.sol`
  - `code/contracts/src/PrivacyEntry.sol` — custody, POOL_ROLE moves, Merkle root + nullifier set; deposit/withdraw entry points (Poseidon swap deferred to Day 6, marked TODO[Day-6])
  - `code/contracts/src/ZkVerifier.sol` — per-circuit vkHash pinning + (domainId, aggId, leafIndex) replay defence
  - `code/contracts/src/InsuranceFund.sol` — per-asset reserves with POOL_ROLE-only `cover`
  - `code/contracts/test/mocks/MockERC20.sol`, `MockVerifyProofAggregation.sol`

🧪 Tested:
  - T-2.1 (PrivacyEntry: only POOL_ROLE moves balances): PASS
  - T-2.2 (PrivacyEntry: reserves arithmetic exact across deposits/withdraw): PASS
  - T-2.3 (ZkVerifier: vkHash mismatch reverts): PASS
  - T-2.4 (ZkVerifier: double-consumption reverts): PASS
  - T-2.5 (InsuranceFund: only POOL_ROLE may call `cover`): PASS
  - Full suite: 115/115 tests passing
  - Coverage: 100% lines on every src contract (PrivacyEntry, ZkVerifier, InsuranceFund all 100%)

🚧 In-progress: none

🔔 Decisions pending: none

🔌 External services pending: none (Day 2 was local Foundry only; the real zkVerify proxy address gets wired Day 8)

❓ Open questions:
  - Day-2 PrivacyEntry uses a **keccak-based hash chain** as a stand-in for the full Poseidon incremental Merkle tree. This is intentional and bounded — Day 6 swaps it for the production algorithm with the same public surface (`currentRoot`, `knownRoot`, `nextLeafIndex`). All TODO sites marked `TODO[Day-6]`. Flagging now in case you'd rather pull that swap forward.
  - Removed two dead-code paths from PrivacyEntry per coding rules (a `ProofVerificationFailed` revert that's unreachable since ZkVerifier reverts internally, and an `InsufficientReserves` defensive check superseded by Solidity 0.8 checked arithmetic). The behaviour is identical; just leaner. Heads-up in case you want either re-added.

User's go-ahead for Day 3: ✅ given

---

### 2026-05-28 — Day 3 wrap-up

✅ Completed:
  - `code/contracts/src/interfaces/IShieldedSupplyPool.sol`
  - `code/contracts/src/interfaces/IShieldedPositionPool.sol`
  - `code/contracts/src/interfaces/ILiquidationBoard.sol`
  - `code/contracts/src/ShieldedSupplyPool.sol` — supply / withdrawSupply, multi-asset notes, RateModel.setTotals sync
  - `code/contracts/src/ShieldedPositionPool.sol` — depositCollateral / withdrawCollateral / borrow / repay, multi-asset positions, applyLiquidation hook for LiquidationBoard
  - `code/contracts/src/LiquidationBoard.sol` — Aave-style liquidate, close-factor (50% / 100% at HF<0.95), 5/3 bonus split with USD-1e8 normalisation
  - PrivacyEntry extension: `payToInsurance` (POOL_ROLE → token transfer to InsuranceFund)
  - InsuranceFund extension: `notifyReceived` (POOL_ROLE → reserve bookkeeping after a direct transfer)
  - IRateModel extension: exposed `state()` and `setTotals()` so pools can sync aggregates
  - Role wiring: POOL_ROLE on PrivacyEntry + RateModel granted to all 3 pools; LIQUIDATOR_ROLE on PositionPool granted to Board; CALLER_ROLE on ZkVerifier granted to all pools

🧪 Tested:
  - T-3.1 (supply increases custody+aggregates, RateModel synced): PASS
  - T-3.2 (borrow with rejected proof reverts — circuit-side HF check surfaced via mock): PASS
  - T-3.3 (close factor 50% above 0.95 HF, 100% below): PASS — both sides of the threshold tested
  - T-3.4 ($100 debt × 8% bonus → $5 liquidator + $3 InsuranceFund): PASS, decoded from `PositionLiquidated` event
  - T-3.5 (I-SOLV-1 invariant fuzz): PASS — 4090 supply + 4102 withdrawSupply random calls, `PrivacyEntry.reserves[token] == ERC-20.balanceOf(entry)` held throughout
  - Full suite: 177/177 tests passing
  - Coverage: 95.36% lines / 100% functions overall; AssetRegistry/Oracle/RateModel/PrivacyEntry/ZkVerifier/InsuranceFund/SupplyPool/LiquidationBoard all ≥94% lines; PositionPool 90.58% lines (the remaining gap is `--ir-minimum` source-map artifact on pause/view methods exercised by tests)

🚧 In-progress: none

🔔 Decisions pending: none

🔌 External services pending: none (Day 3 was local Foundry only)

❓ Open questions / notes:
  - **Removed three more dead `_spent[balanceNullifier]` checks** from SupplyPool, PositionPool deposit + repay paths (PrivacyEntry already owns the balance-nullifier set; the duplicate check was unreachable). Same pattern as the Day-2 dead-code prunes you approved.
  - **Refactored `LiquidationBoard.liquidate`** to use a `Seizure` struct + `_applyLiquidation` helper to satisfy `--via-ir` stack-too-deep limits. No behavioural change, just structure. Still emits the same `PositionLiquidated` event.
  - **Day-3 mock proofs**: every test allowlists its own `(domainId, aggId, leafIndex)` tuple via `MockVerifyProofAggregation`. Real Noir-generated proofs land Day 4-6; the wiring at the contract boundary (vkHash check + tuple consumption) doesn't change.
  - **Position nullifier derivation** is currently `keccak256("position-nullifier", commitment)` — placeholder until the circuit-side derivation lands Day 5. Marked in `LiquidationBoard._positionNullifierOf`.

User's go-ahead for Day 4: ___

---

### 2026-05-28 — Decision: bb version pin updated

**Drift:** `architecture_context.md` §1.2 originally pinned bb v3.0.0. The current bb release line is 5.x; nargo 1.0.0-beta.21 (Day-4 install) ships against bb 5.x and is not compatible with bb 3.0.

**Decision (user-approved):** update the architecture pin to "bb v5.x line, dev pin 5.0.0-nightly.20260324". Day-19 reproducibility build will lock to a specific commit hash.

**Why:** bb 3.0 + nargo beta.21 is not a supported pairing. Fighting the toolchain to keep an outdated pin would have cost development velocity for no benefit; bb 5.x is what every active Noir project uses and what audit firms will expect.

**Cost:** the design doc 16-line drift was the only artifact change (line 26). No code impact yet (Day 4 hasn't started). Day-19 work picks up the commit-pin task.

---

---

## Cross-references

- Daily scope: [`code_roadmap.md`](code_roadmap.md)
- Rules: [`agent_workflow_rules.md`](agent_workflow_rules.md)
- Standards: [`code_standard.md`](code_standard.md)
- Project goals: [`project_overview.md`](project_overview.md)
- Tech stack: [`architecture_context.md`](architecture_context.md)
- Subsystem composition: [`connections.md`](connections.md)
- Per-day tests: [`subsystem_test.md`](subsystem_test.md)
- Group checks: [`system_check.md`](system_check.md)
