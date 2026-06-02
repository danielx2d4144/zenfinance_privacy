# Subsystem 01 — Shielded Pools & Contracts

## 1. Purpose

The on-chain Solidity surface: **9 contracts** on Horizen that hold the
assets, verify the ZK proofs, expose public per-asset market state, and
pay out liquidations. No private state lives here — only commitments,
nullifier-spent flags, per-asset rate indices, and per-position liquidation
triggers.

**Multi-asset by construction:** a single `ShieldedSupplyPool` and a single
`ShieldedPositionPool` hold supply notes and multi-slot borrower
positions across all enabled assets. v1 launches with **USDC + cbBTC**
enabled; **WETH + ZEN** are added in v1.1 via Safe-driven `AssetRegistry`
configuration, no contract redeployment required.

## 2. Contracts

| Contract | Lines (est.) | Role |
|---|---|---|
| `AssetRegistry.sol` | ~150 | Enabled asset list + per-asset risk parameters + oracle feeds. Safe-managed. |
| `ShieldedSupplyPool.sol` | ~450 | Merkle tree of supply notes (each tagged with `assetId`). Spent-nullifier set. Supply / withdraw-supply entry points, parameterized by asset. |
| `ShieldedPositionPool.sol` | ~600 | Merkle tree of multi-slot borrower positions. Spent-nullifier set. Deposit-collateral / withdraw-collateral / borrow / repay entries, parameterized by `(collateralAsset, debtAsset)`. |
| `LiquidationBoard.sol` | ~400 | Per-position multi-asset trigger arrays. Liquidate entry point — picks `(collateralAsset, debtAsset, debtToCover)` Aave-style. |
| `RateModel.sol` | ~300 | Per-asset `supplyIndex` + `borrowIndex` + kink parameters. `accrue(asset)` callable by anyone. |
| `Oracle.sol` | ~120 | Wrapper around Stork feeds. Per-asset freshness assertion. |
| `ZkVerifier.sol` | ~200 | Per-circuit `IVerifyProofAggregation` integration. Holds `vkHash` per circuit; circuit-kind enum includes `(operation, assets)` discriminators. |
| `InsuranceFund.sol` | ~150 | Per-asset reserves. Receives 3% of every liquidation bonus split by token. |
| `AuditorRegistry.sol` | ~80 | Pre-registered auditor public keys (admin-curated). |

Total Solidity surface: ~2,450 lines. Comparable to Aave v3's single market
deployment.

## 3. Key state

### `AssetRegistry`

```solidity
struct AssetConfig {
    address token;                // ERC-20 address (USDC, cbBTC, WETH, ZEN)
    address oracleFeed;           // Stork feed identifier
    uint8   decimals;             // token decimals
    uint16  ltvBps;               // 6500 = 65%
    uint16  liquidationThresholdBps;
    uint16  liquidationBonusBps;
    uint16  protocolFeeOfBonusBps;
    uint128 minBorrowSize;
    uint128 dustDebtThreshold;
    uint16  closeFactorHfThresholdBps;  // 9500 = HF<0.95 → 100% close factor
    bool    suppliable;           // can be lent
    bool    borrowable;           // can be borrowed
    bool    collateralizable;     // can back debt
    bool    enabled;              // master switch
}
mapping(uint8 assetId => AssetConfig) public assets;
uint8 public numAssets;           // currently active; max 16 in v1

event AssetEnabled(uint8 indexed assetId, address token);
event AssetConfigUpdated(uint8 indexed assetId, AssetConfig config);
```

**v1 launch defaults:**

| assetId | Token | LTV | LT | Bonus | Suppliable | Borrowable | Collateral | Enabled |
|---|---|---|---|---|---|---|---|---|
| 0 | USDC | 75% | 80% | 5% | ✓ | ✓ | ✓ | **✓ (v1)** |
| 1 | cbBTC | 65% | 75% | 8% | ✓ | ✓ | ✓ | **✓ (v1)** |
| 2 | WETH | 70% | 80% | 7% | ✓ | ✓ | ✓ | v1.1 |
| 3 | ZEN | 40% | 55% | 12% | ✓ | ✓ | ✓ | v1.2 |

### `ShieldedSupplyPool`

```solidity
// Supply notes: opaque commitments, internally encode (assetId, amount, salt,
// spending_pubkey, supplyIndex_at_deposit).

bytes32[NEXT_TREE_LEVEL] public merkleTree;
uint32   public nextLeafIndex;
bytes32  public currentRoot;
bytes32[ROOT_HISTORY_SIZE] public rootHistory;
mapping(bytes32 nullifierHash => bool) public spent;

mapping(uint8 assetId => uint256) public totalSupplyPerAsset;

event SupplyDeposited(uint8 indexed assetId, uint256 leafIndex, bytes32 commitment, uint256 amount);
event SupplyWithdrawn(uint8 indexed assetId, bytes32 nullifier, uint256 amount);
```

### `ShieldedPositionPool` (replaces `ShieldedBorrowPool`)

```solidity
// A "position note" encodes a full multi-asset position:
//
//   position = Poseidon(
//     spending_pubkey,
//     collaterals[0..NUM_ASSETS],     // per-asset collateral amounts (0 if unused)
//     debts[0..NUM_ASSETS],            // per-asset debt amounts (0 if unused)
//     borrowIndices_at_update[0..NUM_ASSETS],
//     salt
//   )
//
// Up to MAX_ASSETS_PER_POSITION = 8 (sparse encoding for circuit efficiency).

bytes32[NEXT_TREE_LEVEL] public merkleTree;
uint32   public nextLeafIndex;
bytes32  public currentRoot;
bytes32[ROOT_HISTORY_SIZE] public rootHistory;
mapping(bytes32 nullifierHash => bool) public spent;

mapping(uint8 assetId => uint256) public totalCollateralPerAsset;
mapping(uint8 assetId => uint256) public totalBorrowPerAsset;

event PositionUpdated(bytes32 oldNullifier, bytes32 newCommitment);
event CollateralDeposited(uint8 indexed assetId, uint256 amount);
event Borrowed(uint8 indexed assetId, uint256 amount);
event Repaid(uint8 indexed assetId, uint256 amount);
event CollateralWithdrawn(uint8 indexed assetId, uint256 amount);
```

### `LiquidationBoard` (multi-asset triggers)

```solidity
// Per position, an array of trigger thresholds — one per collateral asset.
// A position becomes liquidatable when ANY collateral price drops below its
// trigger (assuming worst case for other prices; conservative).
//
// triggers[i] = price below which "if this asset moves alone, position
// becomes unhealthy assuming all other prices stay constant".

struct LiquidationTrigger {
    uint8   assetId;
    uint128 priceThreshold;       // in USD scaled, e.g., 1e8 for $1.00
}

struct PositionLiquidationInfo {
    bytes32 commitment;
    LiquidationTrigger[] triggers; // length = number of collateral slots in this position
    uint64  lastUpdateBlock;
    bool    active;
}

PositionLiquidationInfo[] public positions;
mapping(bytes32 commitment => uint256 idx) public commitmentToIdx;

event PositionTriggersUpdated(bytes32 indexed commitment, LiquidationTrigger[] triggers);
event PositionRemoved(bytes32 indexed commitment);
event PositionLiquidated(
    bytes32 indexed targetCommitment,
    address indexed liquidator,
    uint8   collateralAssetSeized,
    uint8   debtAssetRepaid,
    uint256 collateralSeized,
    uint256 debtCovered,
    uint256 insuranceFundShare
);
```

**Liquidator UX** (matches Aave's `liquidationCall` signature):

```solidity
function liquidate(
    bytes32 targetCommitment,
    bytes32 residualCommitment,
    uint8   collateralAsset,       // which collateral to seize
    uint8   debtAsset,              // which debt to repay
    uint128 debtToCover,            // amount of debt (capped by close factor)
    LiquidationTrigger[] calldata newTriggers,  // recomputed for the residual
    uint256 domainId, uint256 aggregationId,
    bytes32[] calldata merklePath, uint256 leafCount, uint256 index
) external;
```

### `RateModel` (per-asset)

```solidity
struct AssetRateState {
    uint128 totalSupply;
    uint128 totalBorrow;
    uint128 supplyIndex;          // ray-scaled growth
    uint128 borrowIndex;
    uint64  lastAccrualTimestamp;
    bool    paused;
    uint128 deficit;              // bad-debt accrual for v3.3-style burn
}

struct RateParams {
    uint128 uOptimal;             // e.g., 0.8e18 = 80% optimal utilization
    uint128 slope1;               // pre-kink slope
    uint128 slope2;               // post-kink slope
}

mapping(uint8 assetId => AssetRateState) public state;
mapping(uint8 assetId => RateParams) public params;

function accrue(uint8 assetId) public;
function currentBorrowRate(uint8 assetId) public view returns (uint256);
function currentSupplyRate(uint8 assetId) public view returns (uint256);
```

## 4. External interfaces

### 4.1 User entry points — every operation is parameterized by asset

```solidity
// ShieldedSupplyPool
function supplyAsset(
    uint8 assetId,
    bytes32 balanceNullifier,         // from PrivacyEntry — balance note in `asset` consumed
    bytes32 residualBalanceCommitment,// new balance note (remainder stays in PrivacyEntry)
    bytes32 supplyCommitment,         // new supply note
    uint256 amount,
    uint256 domainId, uint256 aggId, bytes32[] memory path, uint256 leafCount, uint256 idx
) external;

function withdrawSupply(
    uint8 assetId,
    bytes32 supplyNullifier,
    bytes32 newBalanceCommitment,     // balance note credited in PrivacyEntry
    uint256 amount,
    uint256 ...
) external;

// ShieldedPositionPool
function depositCollateral(
    uint8 assetId,
    bytes32 balanceNullifier,         // from PrivacyEntry
    bytes32 residualBalanceCommitment,
    bytes32 oldPositionNullifier,     // or zero if first time
    bytes32 newPositionCommitment,    // new position with this asset added
    uint256 amount,
    LiquidationTrigger[] calldata newTriggers,
    uint256 ...
) external;

function withdrawCollateral(
    uint8 assetId,
    bytes32 oldPositionNullifier,
    bytes32 newPositionCommitment,
    bytes32 balanceCommitment,        // credited in PrivacyEntry
    uint256 amount,
    LiquidationTrigger[] calldata newTriggers,
    uint256 ...
) external;

function borrow(
    uint8 assetId,                    // which asset to borrow
    bytes32 oldPositionNullifier,
    bytes32 newPositionCommitment,    // debt[asset] increased
    bytes32 newBalanceCommitment,     // amount credited to user's PrivacyEntry balance
    uint256 amount,
    LiquidationTrigger[] calldata newTriggers,
    uint256 ...
) external;

function repay(
    uint8 assetId,                    // which debt to reduce
    bytes32 balanceNullifier,         // user's balance note in `asset`
    bytes32 residualBalanceCommitment,
    bytes32 oldPositionNullifier,
    bytes32 newPositionCommitment,    // debt[asset] reduced
    uint256 amount,
    LiquidationTrigger[] calldata newTriggers,
    uint256 ...
) external;
```

### 4.2 Read interfaces (all public, agents + humans)

- `AssetRegistry.assets(assetId)` — per-asset config including current LTV.
- `RateModel.state(assetId)` — per-asset rate state.
- `LiquidationBoard.positions(idx)`, `positions.length` — scan for unhealthy.
- `Oracle.getPrice(assetId)` — current USD price per asset (Stork-fronted).
- `ShieldedSupplyPool.totalSupplyPerAsset(assetId)` — aggregate.
- `ShieldedPositionPool.totalCollateralPerAsset(assetId)`,
  `totalBorrowPerAsset(assetId)` — aggregates.

### 4.3 Admin (Safe-only via `ADMIN_ROLE`)

- `AssetRegistry.enableAsset(assetId, config)` — add ETH or ZEN post-launch.
- `AssetRegistry.updateAssetConfig(assetId, config)` — risk-param changes
  (loosening goes through Timelock per S10).
- `AssetRegistry.disableAsset(assetId)` — pause new borrows / supplies in
  one asset without affecting others.
- `RateModel.setRateParams(assetId, params)`.
- Pause / unpause per asset or global.

## 5. Security & privacy

- **Pure cryptographic privacy** — contracts learn only commitments and
  nullifiers per operation, plus per-asset aggregates.
- **Per-asset isolation** — disabling one asset doesn't freeze the others.
- **Multi-asset HF computation happens inside the circuit** — the contract
  only verifies the proof; it never sees the per-slot amounts.
- **Conservative liquidation triggers** — when multiple collateral assets
  exist, each trigger assumes worst case for the other prices. This may
  over-trigger occasionally; that's fine, the liquidator's circuit
  re-validates with all current prices before seizure.
- **Reentrancy guards + Pausable** on every state-mutating function.
- **No proxy / no upgradability** in v1; bug fixes ship as new contract
  versions + slow migration.

## 6. Agent accessibility notes

- Every operation takes `uint8 assetId` as the first parameter — agents
  pass it from their `Policy.allowedAssets` list.
- The `MultiAssetPolicy` extension in S03 enforces per-asset spending caps
  and per-asset borrowability.
- Reading per-asset aggregate state is a one-line subgraph query (S06).

## 7. Dependencies

- OpenZeppelin: `AccessControl`, `Pausable`, `ReentrancyGuard`, `ECDSA`.
- A pinned Merkle tree library.
- Stork on-chain contract (4 feeds: USDC/USD, cbBTC/USD, WETH/USD, ZEN/USD).
- USDC, cbBTC, WETH, ZEN as ERC-20s on Horizen (OFT for USDC/cbBTC; WETH
  is the standard wrapper; ZEN is the native protocol token's ERC-20).
- `IVerifyProofAggregation` from `zkv-attestation-contracts`.
- `PrivacyEntry.sol` (Subsystem 12) — holds the actual ERC-20s.

## 8. Diagram

```mermaid
graph TB
    USER[User EOA or AgentAccount]

    subgraph Shielded pools (multi-asset)
      SP[ShieldedSupplyPool<br/>multi-asset supply notes]
      PP[ShieldedPositionPool<br/>multi-slot positions]
      LB[LiquidationBoard<br/>per-asset triggers per position]
    end

    subgraph Per-asset registries
      AR[AssetRegistry<br/>config + enable flags]
      RM[RateModel<br/>per-asset indices + kink]
      OR[Oracle<br/>per-asset Stork wrapper]
      IF[InsuranceFund<br/>per-asset reserves]
    end

    subgraph Privacy layer (S12)
      PE[PrivacyEntry<br/>multi-token vault]
    end

    subgraph ZK gate
      ZV[ZkVerifier<br/>per-circuit vkHash]
    end

    subgraph External
      ZKP[zkVerify Aggregation Proxy]
      STORK[Stork on-chain<br/>4 feeds]
      TOKS[USDC, cbBTC, WETH, ZEN]
    end

    USER -- supply/withdraw/<br/>deposit-collateral/borrow/<br/>repay/liquidate<br/>(asset-parameterized) --> SP
    USER --> PP
    USER --> LB

    SP --> PE
    PP --> PE
    LB --> PE

    SP --> ZV
    PP --> ZV
    LB --> ZV
    PE --> ZV
    ZV -- verifyProofAggregation --> ZKP

    SP --> RM
    PP --> RM
    LB --> RM
    LB --> OR
    PP --> OR
    OR --> STORK

    SP --> AR
    PP --> AR
    LB --> AR

    PE -- holds all assets --> TOKS

    LB -- bonus split --> IF

    SAFE[Den Safe<br/>3-of-5] -- ADMIN_ROLE --> AR
    SAFE --> RM
    SAFE --> SP
    SAFE --> PP
    SAFE --> LB
    SAFE --> IF
```
