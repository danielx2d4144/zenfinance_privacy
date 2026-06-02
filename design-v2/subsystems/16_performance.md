# Subsystem 16 — Performance Characteristics

## 1. Purpose

The **authoritative reference** for protocol latency, throughput, and
how to make them better. Every performance claim made elsewhere in
design-v2 traces back here.

For each performance concern, this doc enumerates: the **current
budget**, the **bottleneck**, the **planned mitigation**, the **owning
subsystem**, and the **SLO target**.

## 2. The latency budget (per-operation)

```
   ┌───────────┐  ┌──────────────┐  ┌────────────────────┐  ┌───────────────┐  ┌─────────────┐
   │ 1. Prove  │→ │ 2. Kurier +  │→ │ 3. zkVerify        │→ │ 4. Relayer    │→ │ 5. Horizen  │
   │  (client) │  │   chain inc  │  │    aggregation     │  │    posts on   │  │    settle   │
   │           │  │              │  │    (bottleneck)    │  │    Horizen    │  │    tx       │
   └───────────┘  └──────────────┘  └────────────────────┘  └───────────────┘  └─────────────┘
    3-15 s          6-24 s              2-5 min                 30-60 s            5-30 s
```

| Phase | Time | Mostly fixed? | Owner subsystem |
|---|---|---|---|
| 1. Proof gen | 3-15s | No — improvable (§5) | [S02](02_zk_circuits.md) + client |
| 2. Kurier + chain inclusion | 6-24s | Yes — zkVerify block time | [S04](04_attestation_pipeline.md) |
| 3. **Aggregation** | **2-5 min** | **No — biggest improvement target (§5)** | [S04](04_attestation_pipeline.md) |
| 4. Relayer → Horizen | 30-60s | Yes — Horizen block time + network | external |
| 5. Settle on Horizen | 5-30s | Mostly — depends on wallet | client |

**Typical end-to-end: 3-7 minutes.** Best case 2 min, worst case 10+ min.

## 3. Per-operation timings

Different operations use different circuits with different constraint
counts. Aggregation latency is the same regardless. Proof times shown
are mid-spec laptop (Intel i7 2022, 16GB).

| Operation | Circuit constraints | Browser proof | Server proof | Total typical |
|---|---|---|---|---|
| ENTRY_DEPOSIT | ~2k | 2-4s | 0.5-1s | 3-4 min |
| ENTRY_WITHDRAW | ~3k | 3-5s | 1-2s | 3-5 min |
| CONSOLIDATE_BALANCE | ~5k | 4-6s | 1-2s | 3-5 min |
| SUPPLY | ~4k | 3-6s | 1-2s | 3-5 min |
| WITHDRAW_SUPPLY | ~5k | 4-7s | 1-2s | 3-5 min |
| DEPOSIT_COLLATERAL | ~9k | 6-10s | 2-3s | 4-6 min |
| WITHDRAW_COLLATERAL | ~12k | 8-12s | 3-5s | 4-6 min |
| **BORROW** | **~13k** | **10-15s** | **3-5s** | **4-7 min** |
| REPAY | ~10k | 7-10s | 2-4s | 4-6 min |
| **LIQUIDATE** | **~15k** | **10-15s** | **3-5s** | **4-7 min** |

**Aggregation wait dominates everything.** A 5x speedup in proving moves
total from 4:08 min to 4:00 min — barely perceptible. A 50% speedup in
aggregation moves total from 4:00 to 2:30 — huge UX win.

## 4. Throughput characteristics

Throughput is about how many simultaneous users we can handle.

| Resource | Limit | Notes |
|---|---|---|
| **Aggregation domain `aggregation_size`** | up to 128 proofs / batch | Configured at domain registration; trades latency vs cost per proof |
| **Browser proof generation (parallel)** | client-local; no shared resource | Embarrassingly parallel across users |
| **Server-side prover pool** | depends on instance fleet | Scale horizontally with EC2 fleet |
| **Kurier API rate limit (per key)** | published per tier | We use multiple keys + retries with backoff |
| **Horizen chain throughput** | ~2 TPS for state-mutating tx batches | Limited by L3 block space; not a concern at v1 scale |
| **MCP server connections** | depends on backend fleet | Scale with load balancer + horizontal pods |
| **Subgraph queries / sec** | Goldsky-imposed quota | Upgrade tier if exceeded |

**At expected v1 launch volume (~100-500 active users, ~1000
ops/day), no resource is bottlenecked.**

## 5. The improvement roadmap

Five interventions, in order of impact. Each has an owning subsystem
and an SLO target.

### 5.1 Run our own aggregation domain (-1 to -3 min)

Instead of using zkVerify System Domain `175` (Horizen testnet, bot-published
on the protocol's schedule), register our own domain with:

```rust
aggregation_size = 16    // fits our v1 volume; smaller batches = faster
queue_size = 4           // four in-flight aggregations
```

**Trade-off:** smaller batches mean each proof costs more (less amortization
of the on-chain delivery). Acceptable at v1 scale.

| | Value |
|---|---|
| Implementation | New domain registration script in [S05](05_oracle_and_keepers.md); operational service to call `aggregate(...)` on cadence |
| Owner | [S04](04_attestation_pipeline.md) (submission) + [S05](05_oracle_and_keepers.md) (publish bot) |
| Cost | Storage deposit (~$1k VFY) + publish gas; ongoing operational service |
| Latency reduction | 2-3 min average |
| SLO target | p50 = 60s aggregation; p95 = 120s aggregation |
| Implementation timing | v1.1 (after Spike 1 passes; before public mainnet) |

### 5.2 Server-side proving for browser users (-5 to -10s)

Already designed for agents via MCP server (see [S06](06_data_layer.md)).
Extend the same prover service for human users who opt in.

| | Value |
|---|---|
| Implementation | Add `prove` endpoint to MCP backend; expose via dapp's `acceleratedProving` toggle |
| Owner | [S06](06_data_layer.md) + [S07](07_human_frontend.md) |
| Trade-off | User uploads witness (= their secrets) to our server; documented as a trust opt-in |
| Latency reduction | 10-15s on slow devices; ~5s on fast ones |
| SLO target | p95 server-side proof <3s for any circuit |
| Implementation timing | v1 (covers Q1 device-support gap from [S17](17_device_support.md)) |

### 5.3 Direct on-chain proof verification (-3 to -5 min, premium tier) (v1.5)

Skip aggregation entirely. Submit proof directly to a special on-chain
`verifyProofDirect(...)` entry point on the zkVerify chain's destination
contract.

| | Value |
|---|---|
| Implementation | New contract path in [S01](01_shielded_pools.md) `LendingMarket.executeDirect(...)`; dapp UX for premium tier |
| Cost | ~10× the gas of the aggregated path (≈$2-5 per tx at 10 gwei) |
| Trade-off | User pays more; reverts in 30s vs settles in 3-7 min |
| Best for | Liquidations, large withdrawals, time-sensitive operations |
| Owner | [S01](01_shielded_pools.md) + [S07](07_human_frontend.md) |
| SLO target | p95 ≤45 seconds from submit to confirmation |
| Implementation timing | v1.5 |

### 5.4 Proof pre-generation for predictable ops (-3 to -5s) (v1.5)

For repetitive operations — keeper's `accrue` calls, scheduled rebalances,
backstop liquidations against pre-known commitments — generate proofs
ahead of time so submission is instant.

| | Value |
|---|---|
| Implementation | Background prover queue in [S05](05_oracle_and_keepers.md) keeper service |
| Owner | [S05](05_oracle_and_keepers.md) + [S08](08_agent_runtime.md) (agents can do this themselves) |
| Latency reduction | Marginal (3-5s) but free at scale |
| SLO target | ≥80% of keeper-initiated ops have pre-generated proof at submission |
| Implementation timing | v1.5 |

### 5.5 Migration to self-aggregating chain (-1 to -2 min) (v2+)

Long-term: become our own rollup / parachain with self-aggregation
(Aztec / Penumbra model). 12-18 months of infrastructure work.

| | Value |
|---|---|
| Implementation | Full new sub-chain; substantial team effort |
| Cost | $1-3M of dedicated engineering |
| Latency reduction | 1-2 min |
| Benefit | Full control of aggregation cadence; no external dependency |
| Implementation timing | v2+ (revisit at $100M+ TVL) |

## 6. Realistic speed tiers (the product offering)

| Tier | Settlement | Cost per op | Available | Powered by |
|---|---|---|---|---|
| **Free (v1 default)** | 3-7 min | ~$0.20-0.50 gas | v1 launch | System Domain 175 + browser proving |
| **Pro (v1.1)** | 1-3 min | ~$0.20-0.50 gas + small subscription | v1.1 | Our own aggregation domain + server-side proving (opt-in) |
| **Premium / instant (v1.5)** | 20-45 sec | ~$2-5 gas | v1.5 | Direct on-chain verification path |
| **Future (v2+)** | <1 min for all | ~$0.20-0.50 gas | v2+ | Self-aggregation |

The dapp surfaces these tiers transparently. Agents pick programmatically;
humans pick via a settings toggle.

## 7. The unavoidable physics

We **cannot** match Aave's 2-second settlement on Base/Arbitrum without
giving up privacy.

ZK proofs take real compute. Aggregation is what makes them affordable.
**Choose two of three: privacy, speed, cheap fees.** We pick privacy +
cheap; speed pays the cost.

For users who want instant + cheap + transparent → they use Aave. For
users who want private + cheap → they use us. The market segmentation
is intentional.

## 8. Benchmark methodology

The numbers in this doc need to be empirically calibrated, not just
asserted. Two ways we collect data:

### 8.1 Spike-1 timing capture
The Spike 1 plan ([spikes/01_critical_path.md](../spikes/01_critical_path.md))
includes a `timing.md` artifact. Real numbers from real test runs.
Update [S16 §3](16_performance.md) with empirical numbers after Spike 1.

### 8.2 Production monitoring (after launch)

```
Metric                                          Owner         Target
─────────────────────────────────────────────────────────────────────
zkv_submission_to_aggregated_seconds {p50,p95}  S04           p50<120, p95<240
horizen_settle_time_seconds {p50,p95}           S04           p50<10, p95<30
prove_time_seconds {circuit,p50,p95,p99}        S02/S07/S06   per-circuit SLO
intent_total_seconds {p50,p95,p99}              S06           p50<240, p95<420
operation_failure_rate {kind}                   S04           <0.5%
kurier_unreachable_seconds_total                S04           alert >120/day
```

All metrics exposed via Prometheus + Grafana dashboards. Documented
runbook for each alert.

## 9. SLO targets summary

| SLO | Target (v1) | Target (v1.5+) | Owner |
|---|---|---|---|
| Operation end-to-end p50 | <240s | <90s | [S04](04_attestation_pipeline.md) |
| Operation end-to-end p95 | <420s | <180s | [S04](04_attestation_pipeline.md) |
| Operation end-to-end p99 | <600s | <300s | [S04](04_attestation_pipeline.md) |
| Liquidation submission to seizure | <420s | <180s | [S01](01_shielded_pools.md) + [S04](04_attestation_pipeline.md) |
| Browser prove time, p95 | <15s | <10s | [S02](02_zk_circuits.md) + [S07](07_human_frontend.md) |
| Server prove time, p95 | <3s | <2s | [S06](06_data_layer.md) |
| Subgraph indexing lag | <30s | <15s | [S06](06_data_layer.md) |
| MCP tool-call latency p95 | <500ms | <300ms | [S06](06_data_layer.md) |
| Dapp first-render time | <3s | <2s | [S07](07_human_frontend.md) |

If we miss an SLO for >24h, the operations runbook in [S10](10_governance_admin.md)
escalates.

## 10. Open spike work to validate this doc

- **Spike 5** ([spikes/05_browser_prove_time.md](../spikes/05_browser_prove_time.md) — TBW)
  — measure actual prove time for the 13k-constraint borrow circuit on
  reference devices.
- **Spike 1** (done) — measure actual aggregation time on Volta.
- **Spike 7** (TBW) — load-test the data layer to confirm
  throughput-per-pod numbers.

## 11. Dependencies

- [S02](02_zk_circuits.md) — circuit constraint counts drive prove-time
  budget
- [S04](04_attestation_pipeline.md) — aggregation pipeline timing
- [S05](05_oracle_and_keepers.md) — keeper cadence and price freshness
- [S06](06_data_layer.md) — server-side prover, MCP latency
- [S07](07_human_frontend.md) — dapp UX timing
- [S17](17_device_support.md) — device-class breakdown
- External: Horizen block time, zkVerify aggregation cadence, Stork
  publisher rate, Kurier SLA

## 12. Diagram

```mermaid
graph LR
  USER[User clicks 'Borrow']

  subgraph Stage 1: Prove (3-15s)
    P1[Build witness]
    P2[bb.js / server prover]
  end

  subgraph Stage 2: Kurier (6-24s)
    K1[POST /submit-proof]
    K2[zkVerify chain inclusion]
    K3[GRANDPA finality]
  end

  subgraph Stage 3: Aggregation (2-5 min) ★ bottleneck
    A1[Queue]
    A2[Wait for batch fill / time]
    A3[NewAggregationReceipt]
  end

  subgraph Stage 4: Relayer (30-60s)
    R1[Relayer picks up]
    R2[submitAggregation on Horizen]
    R3[Horizen block]
  end

  subgraph Stage 5: Settle (5-30s)
    S1[User wallet sign]
    S2[executeGatedAction]
    S3[Tx confirmed]
  end

  USER --> P1 --> P2 --> K1 --> K2 --> K3 --> A1 --> A2 --> A3 --> R1 --> R2 --> R3 --> S1 --> S2 --> S3

  M1{Improvement #1<br/>Own aggregation domain<br/>cuts ★ by 50-70%}
  M2{Improvement #2<br/>Server-side proving<br/>cuts Stage 1 by 80%}
  M3{Improvement #3<br/>Direct on-chain<br/>skips Stage 3 entirely<br/>10× gas cost}

  M1 -.-> A2
  M2 -.-> P2
  M3 -.-> A1
```
