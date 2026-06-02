# Subsystem 05 — Oracle & Keepers

## 1. Purpose

The off-chain robots that keep the protocol fresh: **price pusher**
(Stork), **interest accrual poker**, **backstop liquidator**. Stateless,
restart-safe Go/Node services running as systemd units or k8s Deployments.

## 2. Components

### 2.1 Price keeper

Loop:
```
every 30 seconds:
  for each market in [cbBTC]:
    signed_update = GET https://rest.stork-oracle.network/v1/prices/latest?ids=BTCUSD
    Stork.updateTemporalNumericValuesV1{value: STORK_FEE}(signed_update)
    if |new_price - last_price| / last_price > 0.005:    # > 0.5% move
      schedule_an_accrue()                                # tighten interest cadence briefly
```

Also pushed on-demand by any borrow/withdraw/liquidate request that's
about to execute, ensuring freshness ≤30s.

### 2.2 Interest accrual poker

```
every 5 minutes (or on >0.5% price move):
  RateModel.accrue()
```

Cheap public call. `RateModel.accrue()` updates `supplyIndex` /
`borrowIndex` based on elapsed time × current rate. Any account can call
it — we just guarantee someone does.

### 2.3 Backstop liquidator

```
loop:
  positions = scanLiquidationBoard(currentPrice)
  for p in positions:
     wait 30 seconds (give 3rd-party liquidators first crack)
     if p still unconsumed:
       generate liquidate proof against p
       submit to Kurier
       wait for aggregation
       LiquidationBoard.liquidate(p.commitment, ...)
       claim seized collateral → swap to USDC → refill float
```

Funded with USDC from treasury (Subsystem 10 allocates). Acts as
lender-of-last-resort.

## 3. Configuration

```yaml
price_keeper:
  rpc_url: ${HORIZEN_RPC}
  stork_rest: https://rest.stork-oracle.network
  stork_contract: 0x...
  feeds:
    cbBTC_USD: 0xfeed_id_here
  cadence_seconds: 30
  large_move_threshold_bps: 50

interest_keeper:
  rpc_url: ${HORIZEN_RPC}
  rate_model_address: 0x...
  cadence_seconds: 300

backstop_liquidator:
  rpc_url: ${HORIZEN_RPC}
  liquidation_board: 0x...
  usdc_float_target: 200000_000000          # $200k in USDC decimals
  wait_seconds_before_action: 30
  agent_account: 0x...                      # ERC-4337 wallet (Subsystem 03)
```

## 4. Operational notes

- **All keys in AWS KMS.** Fetched at startup; no on-disk secrets.
- **Each keeper has its own EOA** funded with just enough ETH for gas + Stork
  fees.
- **Failure isolation.** Price keeper down → borrows fail freshness check
  (safe). Accrual keeper down → indices stale but math still correct on read.
  Backstop down → 3rd-party liquidators still operate.
- **Observability:** Prometheus metrics, Grafana dashboards. Page on:
  - Stork push failure for >5 min
  - Accrue not called for >15 min
  - Backstop float < $50k
- **Restart-safe.** No durable state; just config + KMS keys.

## 5. Agent accessibility notes

The backstop liquidator is **itself an agent** running our own protocol. It
holds an `AgentAccount` with a policy "may liquidate any position, no
spending cap, no time limit." This is the simplest demonstration that the
agent layer (Subsystem 03) works — we are our own first customer.

3rd-party liquidator bots also use the **same MCP server** humans use, just
with their own credentials. They can be built in <100 lines around our SDK.

## 6. Dependencies

- Stork on-chain contract + REST API.
- Horizen RPC.
- ERC-4337 bundler (for backstop's userOps).
- Subgraph (for liquidation board reads — subsystem 06).
- AWS KMS.

## 7. Diagram

```mermaid
graph LR
  subgraph Off-chain keepers (we operate)
    PK[Price Keeper<br/>30s loop + on-demand push]
    IK[Interest Keeper<br/>5min loop]
    BL[Backstop Liquidator<br/>watches LiquidationBoard]
    KMS[AWS KMS]
  end

  subgraph External
    STORKAPI[Stork REST API]
  end

  subgraph Horizen
    STORKC[Stork on-chain]
    RM[RateModel]
    LB[LiquidationBoard]
    SP[ShieldedSupplyPool]
    BAA[Backstop AgentAccount]
  end

  KMS --> PK
  KMS --> IK
  KMS --> BL

  PK -- price quotes --> STORKAPI
  PK -- updateTemporalNumericValuesV1 --> STORKC

  IK -- accrue() --> RM

  BL -- scan positions --> LB
  BL -- userOp via bundler --> BAA
  BAA -- liquidate(commitment, ...) --> LB
  BL -- USDC supply for repays --> SP
```
