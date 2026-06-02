# Subsystem 14 — Interest & APY Mechanics

## 1. Purpose

The **authoritative reference** for how the protocol handles interest:
borrow rates, supply rates, accrual, the reserve-factor split, and
bad-debt socialization. Other subsystems reference this one rather than
re-defining the math.

This is a cross-cutting topic — the actual code lives in S01's
`RateModel.sol` + S02's borrow/repay/withdraw circuits + S05's keeper. S14
is the **design contract** they all satisfy.

## 2. The core model in one paragraph

Each asset has **two public indices on chain** — `supplyIndex[asset]` and
`borrowIndex[asset]` — that grow over time at the current rate. Private
notes store the **amount at deposit/update time + the index value at that
moment**. To know your current value, you locally divide:
`current = note.amount × index_now / index_at_note`. This is exactly how
Aave's aTokens work, just with the note kept off-chain.

**The user computes their own accrued interest locally.** The chain never
sees per-user amounts. The chain sees only the public indices that all
holders of that asset share.

## 3. The rate curve (per asset, kinked)

```
U[asset] = totalBorrow[asset] / totalSupply[asset]    # public, computed on read

borrowRate(asset) =
    if U ≤ U_optimal[asset]:
        slope1[asset] × (U / U_optimal[asset])
    else:
        slope1[asset] + slope2[asset] × ((U - U_optimal[asset])
                                          / (1 - U_optimal[asset]))

supplyRate(asset) =
    borrowRate(asset) × U × (1 - reserveFactor[asset])
```

`reserveFactor` is the cut going to the protocol's `InsuranceFund`
reserve for that asset.

### 3.1 Visualised — USDC with v1 launch params

```
U_optimal = 80%,  slope1 = 4% APR,  slope2 = 75% APR,  reserveFactor = 10%

borrowRate (APR)
    79% ┤                                    ╱
    70% ┤                                   ╱
    60% ┤                                  ╱
    50% ┤                                 ╱
    40% ┤                                ╱
    30% ┤                               ╱
    20% ┤                              ╱
    10% ┤                  ___________╱
     4% ┤      ___________╱
     0% ┤_____╱
         0%     20%     40%     60%     80%    100%   utilization U
                                        ↑
                                     U_optimal (kink)
```

Below the kink, rate climbs linearly to 4%. Above the kink, each 1%
utilization adds ~3.75% APR. The kink penalizes high utilization, keeping
withdrawal headroom for lenders.

## 4. v1 launch parameters (full table)

Set in `AssetRegistry` at deploy; modifiable by Safe per [S10](10_governance_admin.md)
with 48h timelock on loosening, immediate on tightening.

| assetId | Symbol | U_optimal | slope1 | slope2 | reserveFactor | At 80% U: borrow APR | At 80% U: supply APR | Enabled |
|---|---|---|---|---|---|---|---|---|
| 0 | USDC | 80% | 4% | 75% | 10% | 4.00% | 2.88% | **v1** |
| 1 | cbBTC | 45% | 2% | 300% | 20% | 119% (well above kink) | — | **v1** |
| 2 | WETH | 70% | 3% | 100% | 15% | 17.3% (above kink) | — | v1.1 |
| 3 | ZEN | 35% | 5% | 500% | 25% | (very high) | — | v1.2 |

Design intent per asset:

| Asset | Curve philosophy |
|---|---|
| **USDC** | Stablecoin; deep demand-side liquidity expected. Moderate slope2; standard 10% reserve. |
| **cbBTC** | Long-tail collateral. Few borrowers expected initially. Low U_optimal punishes anyone trying to lever up; high slope2 makes excess utilization painful. 20% reserve hedges insurance. |
| **WETH** | Mid-volatility. Higher reserve than USDC (15%) because ETH-denominated borrowing is uncommon. |
| **ZEN** | Smallest, most volatile market. Highest reserve (25%); steepest slope2. Conservative until liquidity proves out. |

These are **starting parameters subject to sensitivity analysis** in the
spike phase. Final values approved by Safe at deploy time per [S10](10_governance_admin.md).

## 5. Index growth — how `accrue` works

The on-chain `RateModel.accrue(uint8 assetId)`:

```solidity
function accrue(uint8 assetId) public {
    AssetRateState storage s = state[assetId];
    if (block.timestamp == s.lastAccrualTimestamp) return;

    uint256 brate = currentBorrowRate(assetId);
    uint256 srate = brate
        * utilization(assetId) / 1e27
        * (1e4 - reserveFactor[assetId]) / 1e4;

    uint256 deltaT = block.timestamp - s.lastAccrualTimestamp;

    // linear-per-accrual (Aave/Compound-style)
    s.borrowIndex = s.borrowIndex
        * (1e27 + brate * deltaT / SECONDS_PER_YEAR) / 1e27;
    s.supplyIndex = s.supplyIndex
        * (1e27 + srate * deltaT / SECONDS_PER_YEAR) / 1e27;

    s.lastAccrualTimestamp = uint64(block.timestamp);

    emit IndexAccrued(assetId, s.borrowIndex, s.supplyIndex, block.timestamp);
}
```

Indices are stored as ray-scaled `uint128` (precision = 1e27).

### 5.1 Who triggers accrual

| Trigger | Frequency | Source | Effect |
|---|---|---|---|
| Interest keeper (we run) | every 5 min per enabled asset | [S05 §3.2](05_oracle_and_keepers.md) | Steady index growth so dapp displays are at most 5 min stale |
| Operation pre-step (inline) | every borrow / repay / supply / withdraw / liquidate / etc. | [S01](01_shielded_pools.md) | Guarantees fresh indices at the moment of state mutation |
| Anyone permissionlessly | optional | `RateModel.accrue` is `public` | MEV bots may call during high-volatility for snapshot purposes |

Because operations call `accrue` inline, **every state-changing user
action sees fresh indices.** The keeper's role is purely to keep passive
readers (the dapp's "your accrued interest" display) close to real-time.

### 5.2 Linear vs continuous compounding — known approximation

We use linear-per-accrual:
```
index_new = index_old × (1 + rate × deltaT)
```

True continuous compounding would be:
```
index_new = index_old × exp(rate × deltaT)
```

For 5-minute accrual intervals and APRs below 100%, the error is < 0.001%
per call. Identical to Aave's choice; not a real issue.

For very high rates (slope2 region above the kink), the error grows. At
500% APR with 5-min intervals, linear undercharges by ~0.03% per year —
still negligible. If we ever raise slope2 dramatically, revisit.

## 6. User-side interest computation

### 6.1 Lender (supply side) — concrete walkthrough

**t=0: Supply 50,000 USDC.**

```
public chain state:
  supplyIndex[USDC]_at_t0 = 1.052730000e27
```

Lender's encrypted supply note:

```
note = {
  assetId: 0,                                  // USDC
  amount: 50_000_000_000n,                     // 50k USDC (6 decimals)
  supplyIndex_at_deposit: 1.052730000e27,
  salt: 0x...,
  spending_pubkey: 0x...,
}
```

**t=90d: Lender checks their balance in the dapp.**

```
public chain state:
  supplyIndex[USDC]_at_t90 = 1.062500000e27       (grew at ~2.6% APR)
```

The dapp decrypts the note locally and computes:

```typescript
const currentValue =
  (note.amount * supplyIndex_now) / note.supplyIndex_at_deposit;
//  = (50_000_000_000n * 1062500000000000000000000000n)
//  / 1052730000000000000000000000n
//  ≈ 50_463_988_xxx                            // ≈ 50,464 USDC

const accruedInterest = currentValue - note.amount;
//  ≈ 463_988 ≈ 464 USDC over 90 days = ~3.77% APR realised
```

**The chain never sees the 50,464 figure.** Only `supplyIndex` is on chain.

### 6.2 Lender withdraws partial

Lender wants to withdraw 30,464 USDC (the 30k principal + the 464 interest
they want to take out, leaving the rest):

The `withdraw_supply` circuit (S02) constructs a witness with:
- **Private:** the note, secret key, Merkle path
- **Public:** old nullifier, new commitment (for the 20k remaining), recipient (balance commitment in PrivacyEntry), `supplyIndex_now`, `amount_out = 30_464_000_000`
- **Asserts:**
  ```
  amount_out ≤ note.amount × supplyIndex_now / note.supplyIndex_at_deposit
  ```
- **Creates a new supply note** representing the 20k principal that stays
  in the pool, with `supplyIndex_at_deposit = supplyIndex_now`.

After settlement: the lender's PrivacyEntry balance has +30,464 USDC, and
they hold a new supply note for the residual 20k.

### 6.3 Borrower (debt side) — concrete walkthrough

**t=0: Borrower opens a position.**

Position note:

```
position = {
  collaterals: { cbBTC: 1_000_000_000_000_000_000n },     // 1 cbBTC
  debts: { USDC: 30_000_000_000n },                       // 30k USDC borrowed
  borrowIndices_at_update: { USDC: 1.041800000e27 },
  salt, spending_pubkey,
}
```

**t=30d: Borrower wants to know their current debt.**

```
public chain state:
  borrowIndex[USDC]_at_t30 = 1.045100000e27               (grew at ~3.85% APR)
```

The dapp computes:

```typescript
const currentDebt =
  (position.debts.USDC * borrowIndex_now)
  / position.borrowIndices_at_update.USDC;
//  = (30_000_000_000n * 1045100000000000000000000000n)
//  / 1041800000000000000000000000n
//  ≈ 30_095_018_xxx                                       // ≈ 30,095 USDC

const interestOwed = currentDebt - 30_000_000_000n;
//  ≈ 95 USDC over 30 days = ~3.85% APR
```

### 6.4 Borrower repays — accrual happens inside the circuit

When the borrower calls `repay`, the circuit (S02) accrues every debt
slot before applying the repayment:

```rust
// inside the repay circuit (excerpt)
for i in 0..MAX_ASSETS {
    if old_position.debts[i] > 0 {
        let accrued = old_position.debts[i] * current_borrowIndices[i]
                    / old_position.borrowIndices_at_update[i];
        new_position.debts[i] = accrued;
    }
    new_position.borrowIndices_at_update[i] = current_borrowIndices[i];
}

// apply the repayment to the named asset
new_position.debts[debt_asset_id] -= amount_repaid;
```

So the new position note has updated debts (with accrued interest baked
in) and refreshed snapshot indices. **Interest is realised on every
operation** — until the next operation, it's virtual.

### 6.5 Multi-asset accrual across slots

If a position has debts in multiple assets (e.g., 30k USDC + 2 WETH), each
debt slot accrues independently per its own asset's `borrowIndex`. The
circuit walks all 8 slots; the operation touches one. The other 7 are
silently brought up to date so the new commitment captures the current
total debt picture, not just the change.

## 7. Reserve factor → protocol revenue

The `reserveFactor` per asset is the **fraction of interest that flows to
the protocol** rather than to lenders. We use it to fund
`InsuranceFund[asset]`.

```
borrowers pay:  borrowRate
lenders earn:   borrowRate × U × (1 - reserveFactor)
protocol gets:  borrowRate × U × reserveFactor   → InsuranceFund
```

### 7.1 Concrete with USDC at 80% utilization

- 100 USDC of supply earns interest from 80 USDC of borrows.
- Borrowers pay 4% APR × 80 USDC = **3.20 USDC/year** in interest.
- Lenders get 90% of that: **2.88 USDC/year** spread across 100 USDC of
  supply → **2.88% supply APR**.
- Protocol gets 10%: **0.32 USDC/year** → `InsuranceFund[USDC]` per 100
  USDC of supply.

### 7.2 Mechanic: reserve accrual without per-tx fees

There is no explicit "fee collection" transaction. The split is embedded
in the index growth: `supplyIndex` grows at the **net rate after the
reserve factor**, while `borrowIndex` grows at the **gross rate**. The
gap between them is the protocol's revenue, which crystallises into the
`InsuranceFund` whenever a position or supply note interacts with the
pool.

Concretely, the contract tracks:

```solidity
state[assetId].cumulativeReserveAccrued  // accumulator
```

and `InsuranceFund.payBadDebt` / withdrawal flows are netted against this.
Full reconciliation happens periodically via a Safe-callable
`settleReserves(assetId)` function.

## 8. Bad debt → supplyIndex reduction (last resort)

When liquidation leaves residual unrecoverable debt:

1. **First**: `InsuranceFund.payBadDebt(asset, amount)` covers as much as
   possible from accumulated reserves.
2. **If insurance is insufficient**: the residual is added to
   `state[asset].deficit`, and `supplyIndex` is proportionally reduced:

   ```
   supplyIndex_new = supplyIndex_old × (1 - deficit / totalSupply)
   ```

   This dilutes all lender claims by a tiny fraction — **proportional
   socialization**. Standard Aave v3.3 pattern; lenders are aware via the
   dapp's TOS.

The dapp's **solvency widget** (S07 §3) surfaces the per-asset deficit so
users can see if any socialization has occurred or is impending.

## 9. APY display — what users and agents see

### 9.1 Human dapp (S07)

Per-market card, live from chain reads:

| Field | Source |
|---|---|
| **Supply APR** | `RateModel.currentSupplyRate(asset)` |
| **Borrow APR** | `RateModel.currentBorrowRate(asset)` |
| **Utilization** | `totalBorrow / totalSupply` per asset |
| **Total Supplied** | `state[asset].totalSupply` (aggregate, public) |
| **Total Borrowed** | `state[asset].totalBorrow` |
| **Reserve Factor** | `assets[asset].reserveFactor` |

Per-position view (computed locally from decrypted notes + public indices):

| Field | How |
|---|---|
| **Current supply value (per asset)** | `note.amount × supplyIndex_now / note.supplyIndex_at_deposit` |
| **Accrued interest (per asset)** | `currentValue - note.amount` |
| **Realised APR** | `(currentValue / note.amount)^(SECONDS_PER_YEAR/elapsed) - 1` |
| **Current debt (per asset)** | `position.debts[i] × borrowIndex_now / position.borrowIndices_at_update[i]` |
| **Interest paid (per asset)** | `currentDebt - position.debts[i]` |
| **Health factor** | multi-asset formula from S02 §4 |

### 9.2 Agent / MCP (S06, S13)

```typescript
const market = await mcp.tool("market.get", { asset: "USDC" });
// {
//   asset: "USDC",
//   supplyIndex: "1062500000000000000000000000",
//   borrowIndex: "1051200000000000000000000000",
//   lastAccrual: "2026-05-24T11:42:17Z",
//   totalSupply: "12500000000000",
//   totalBorrow: "8750000000000",
//   utilizationBps: 7000,
//   supplyApyBps: 252,         // 2.52% APR
//   borrowApyBps: 350,         // 3.50% APR
//   reserveFactorBps: 1000,    // 10%
//   uOptimalBps: 8000,
//   slope1Bps: 400,
//   slope2Bps: 7500,
//   deficit: "0"
// }

const history = await mcp.tool("market.history", {
  asset: "USDC",
  from: "2026-04-24T00:00:00Z",
  to:   "2026-05-24T00:00:00Z",
  resolution: "1h"
});
// → array of { ts, supplyIndex, borrowIndex, utilizationBps,
//             supplyApyBps, borrowApyBps }
```

### 9.3 Subgraph (S06) timeseries

A new `MarketHistory` entity records every `IndexAccrued` event:

```graphql
type MarketHistoryPoint @entity {
  id: ID!                              # txHash-logIndex
  asset: String!
  timestamp: BigInt!
  supplyIndex: BigInt!
  borrowIndex: BigInt!
  utilizationBps: Int!
  totalSupply: BigInt!
  totalBorrow: BigInt!
  supplyApyBps: Int!
  borrowApyBps: Int!
}
```

Retention: full granularity for 30 days; downsampled to 1h for 1 year;
1d for older. The dapp's history charts query this.

## 10. Where this is enforced across subsystems

| Concern | Owned by | Section |
|---|---|---|
| `RateModel.sol` state + functions + admin | [S01](01_shielded_pools.md) | §3 (RateModel) |
| Per-asset `RateParams` storage | [S01](01_shielded_pools.md) | §3 (AssetRegistry) |
| `reserveFactor` per asset | [S01](01_shielded_pools.md) | §3 (AssetRegistry) |
| Interest accrual inside circuits | [S02](02_zk_circuits.md) | §4-5 (multi-asset accrual in borrow/repay) |
| Interest keeper service (5-min cadence) | [S05](05_oracle_and_keepers.md) | §3.2 |
| Market history timeseries indexing | [S06](06_data_layer.md) | (subgraph schema additions) |
| Bad-debt → supplyIndex reduction | [S01](01_shielded_pools.md) | §5 (security & privacy) + [S14](14_interest_and_apys.md) §8 |
| APY display in dapp | [S07](07_human_frontend.md) | §3 |
| APY via MCP/REST | [S13](13_api_contract.md) | §5.1 + §10.4 |

## 11. Audit-relevant invariants

These are the **mathematical invariants** auditors should verify hold across
all operations:

1. **Conservation of value**: for any asset,
   `sum(supply_notes_outstanding × supplyIndex) ≤ totalSupply_chain ×
   supplyIndex`. Strict equality minus reserveFactor accrual + deficit.

2. **Borrow-supply parity**: per asset,
   `totalSupply × supplyIndex_growth = totalBorrow × borrowIndex_growth
   × (1 - reserveFactor) - bad_debt`. Verifies the rate split is correct.

3. **Index monotonicity**: `supplyIndex` and `borrowIndex` are
   non-decreasing (except in the bad-debt socialization case, where
   `supplyIndex` decreases by a documented formula).

4. **Accrual idempotence**: calling `accrue(asset)` twice in the same
   block is a no-op.

5. **Circuit-on-chain alignment**: any circuit's witness must use the
   same `borrowIndex / supplyIndex` value as the contract's storage at
   the proof-aggregation block. Drift here = silent wrong-amount risk.

6. **Reserve-factor monotonicity**: `reserveFactor[asset] < 1e4` at all
   times (otherwise lenders earn negative rate).

## 12. Open work before launch

- **Sensitivity analysis** on `(slope1, slope2, U_optimal, reserveFactor)`
  per asset. The launch values in §4 are starting points; we want to
  stress-test under bear / bull scenarios.
- **MarketHistory entity** retention + downsampling policy needs an
  actual implementation in the subgraph.
- **`settleReserves(asset)` Safe-callable function** needs spec — when
  does the protocol crystallise accumulated reserve into the
  InsuranceFund? Probably weekly, but TBD.
- **Pure-exponential accrual** as an upgrade option — for v1 we ship
  linear-per-accrual (Aave-style); revisit if slope2 use becomes common.

## 13. Dependencies

- [S01](01_shielded_pools.md) `RateModel.sol`, `AssetRegistry.sol`,
  `InsuranceFund.sol`.
- [S02](02_zk_circuits.md) circuits — borrow, repay, withdraw, liquidate
  all read public indices and write fresh ones into their output
  positions.
- [S05](05_oracle_and_keepers.md) interest keeper service.
- [S06](06_data_layer.md) subgraph `MarketHistory` entity + REST/MCP
  exposure.
- [S07](07_human_frontend.md) dapp display widgets.
- [S10](10_governance_admin.md) Safe-driven parameter tuning (with
  timelock).
- [S13](13_api_contract.md) `market.get` / `market.history` tool +
  endpoint schemas.

## 14. Diagram

```mermaid
graph TB
  subgraph On-chain (public)
    REG[AssetRegistry<br/>reserveFactor, slope1, slope2, U_optimal per asset]
    RM[RateModel<br/>per-asset supplyIndex, borrowIndex]
    IF[InsuranceFund<br/>per-asset reserves]
  end

  subgraph Off-chain ledger (private notes)
    LN[Lender supply note<br/>amount, supplyIndex_at_deposit]
    BN[Borrower position note<br/>debts[], borrowIndices_at_update[]]
  end

  subgraph Accrual triggers
    IK[S05 Interest keeper<br/>every 5 min per asset]
    OPS[Any borrow/repay/<br/>supply/withdraw op<br/>S01 contracts]
    ANY[Anyone permissionlessly]
  end

  IK -- accrue(asset) --> RM
  OPS -- accrue(asset) inline --> RM
  ANY -- accrue(asset) --> RM

  REG --> RM

  RM -- supplyIndex growth (net of reserveFactor) --> LN
  RM -- borrowIndex growth (gross) --> BN
  RM -- reserveFactor × utilization × borrowRate --> IF

  IF -- payBadDebt on liquidation deficit --> RM
  RM -- supplyIndex reduced if IF exhausted --> LN

  subgraph Display layer (read-only)
    UI[S07 dapp APY widgets]
    MCP[S06 market.get / market.history]
    SUB[S06 subgraph MarketHistory entity]
  end

  RM -- IndexAccrued events --> SUB
  SUB --> UI
  SUB --> MCP
  RM -- currentRate views --> UI
  RM --> MCP

  LN -- locally decrypted + computed --> UI
  BN -- locally decrypted + computed --> UI
```
