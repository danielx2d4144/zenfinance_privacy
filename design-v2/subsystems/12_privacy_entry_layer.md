# Subsystem 12 — Privacy Entry Layer

## 1. Purpose

A **single point of contact** between the public ERC-20 world and the
shielded protocol. Holds all custodial assets (USDC, cbBTC, WETH, ZEN —
v1 launches with 2 of those active); lets every user operate inside a
**private balance** that is consumed/refreshed by ZK proofs across all
subsequent operations (supply, withdraw, deposit collateral, borrow,
repay, liquidate) — for any combination of assets the user holds.

**Result:** a user's external wallet appears on Horizen **only at funding
and at exit** — never on per-operation activity, no matter how many
supplies, borrows, repays, or withdrawals they do across the 4 assets in
between.

This is the **Aztec Connect / Penumbra / Railgun model** adapted to a
multi-asset lending protocol.

## 2. Why it exists

Without this subsystem, the v2 design exposes the user's wallet address on
every operation (deposit, withdraw, borrow, repay). For users who hold
**one main wallet** (the realistic majority), each operation creates a
public footprint that — combined — leaks the user's full activity to a
chain-analysis observer.

Adding `PrivacyEntry` breaks the per-operation visibility. The wallet's
public footprint compresses to:

| Public chain event | When it happens |
|---|---|
| `0xABC → PrivacyEntry` (ERC-20 transfer in) | **only** when the user funds new external capital |
| `PrivacyEntry → 0xABC` (ERC-20 transfer out) | **only** when the user withdraws to external |
| **Anything else** | invisible to external observers; only ZK proofs and commitment-tree updates |

## 3. The contract

### 3.1 `PrivacyEntry.sol`

```solidity
contract PrivacyEntry is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant POOL_ROLE = keccak256("POOL");

    // Token vault — holds all custodial assets
    mapping(address token => uint256) public reserves;

    // Merkle tree of balance commitments
    bytes32[NEXT_TREE_LEVEL] public balanceTree;
    uint32  public nextLeafIndex;
    bytes32 public currentRoot;
    bytes32[ROOT_HISTORY_SIZE] public rootHistory;

    // Spent-nullifier set for balance commitments
    mapping(bytes32 nullifierHash => bool) public spent;

    // ──────────── External entry ────────────
    function deposit(
        address token,
        uint256 amount,
        bytes32 commitment,            // balance-note commitment for the depositor
        bytes calldata permit,         // optional EIP-2612 permit
        uint256 deadline
    ) external nonReentrant whenNotPaused;

    function withdraw(
        bytes32 nullifier,
        bytes32 newCommitment,         // residual balance commitment if not fully withdrawn
        address token,
        address recipient,
        uint256 amount,
        uint256 domainId,
        uint256 aggId,
        bytes32[] calldata merklePath,
        uint256 leafCount,
        uint256 index
    ) external nonReentrant whenNotPaused;

    // ──────────── Internal balance moves (called by pool contracts via POOL_ROLE) ────────────
    function spendBalance(
        bytes32 nullifier,
        bytes32 newBalanceCommitment,
        bytes32 destinationCommitment,  // the supply/borrow/whatever note being created elsewhere
        // single aggregation tuple covers both proofs
        uint256 domainId, uint256 aggId,
        bytes32[] calldata merklePath, uint256 leafCount, uint256 index
    ) external onlyRole(POOL_ROLE);

    function creditBalance(
        bytes32 newCommitment
    ) external onlyRole(POOL_ROLE);

    // ──────────── Consolidation (UX helper) ────────────
    function consolidate(
        bytes32[] calldata nullifiers,   // 2-8 balance notes consumed
        bytes32 newCommitment,           // one fresh balance note
        uint256 domainId, uint256 aggId, // single ZK proof for the merge
        bytes32[] calldata merklePath, uint256 leafCount, uint256 index
    ) external nonReentrant whenNotPaused;
}
```

### 3.2 How the pool contracts change

Previously `ShieldedSupplyPool.deposit(...)` pulled USDC from the user's
wallet directly. Now it consumes a balance commitment instead:

```solidity
// NEW signature in ShieldedSupplyPool.sol
function supply(
    bytes32 balanceNullifier,           // input: balance note being spent
    bytes32 newBalanceCommitment,       // output: residual balance note
    bytes32 supplyCommitment,           // output: new supply note
    uint256 domainId, uint256 aggId,
    bytes32[] calldata merklePath, uint256 leafCount, uint256 index
) external nonReentrant whenNotPaused {
    // 1. Verify the ZK proof — the leaf encodes the inputs/outputs and asserts
    //    that input.amount = newBalance.amount + supplyCommitment.amount and
    //    all share the same spending_pubkey and token type (USDC)
    require(_verifyProof(BALANCE_TO_SUPPLY_KIND, leaf, ...), "invalid");

    // 2. Tell PrivacyEntry to mark the balance nullifier spent + insert residual
    PrivacyEntry(privacyEntry).spendBalance(
        balanceNullifier, newBalanceCommitment, supplyCommitment, ...
    );

    // 3. Insert the supply commitment into our own tree
    _insertSupplyCommitment(supplyCommitment);

    emit Supplied(supplyCommitment);
}
```

Similarly:
- `ShieldedSupplyPool.unsupply(...)` consumes a supply note, produces a
  new balance commitment in PrivacyEntry.
- `ShieldedBorrowPool.lockCollateral(...)` consumes a balance note (cbBTC),
  produces a borrow note.
- `ShieldedBorrowPool.borrow(...)` produces a new balance note (USDC) for
  the borrower.
- `ShieldedBorrowPool.repay(...)` consumes a balance note (USDC), reduces
  debt.
- `LiquidationBoard.liquidate(...)` deposits the seized collateral into a
  balance note for the liquidator (instead of `transfer` to their wallet).

**Every "external ERC-20" reference in the v2 design becomes "balance
note in PrivacyEntry."**

## 4. Updated circuit set

Circuits change from 7 to **10** to reflect balance-note semantics. The
shared structure (commitments, nullifiers, Poseidon hashing) is reused.

| # | Circuit | Inputs | Outputs |
|---|---|---|---|
| 01 | `entry_deposit` | external amount (public) | one balance note |
| 02 | `entry_withdraw` | one balance note | residual balance note + external amount |
| 03 | `balance_to_supply` | balance note (USDC) | residual balance + supply note |
| 04 | `supply_to_balance` | supply note | balance note (USDC) |
| 05 | `balance_to_collateral` | balance note (cbBTC) | residual balance + borrow note (debt=0) |
| 06 | `collateral_to_balance` | borrow note (no debt) | balance note (cbBTC) |
| 07 | `borrow` | borrow note + balance note | new borrow note (debt+) + new balance note (USDC+) |
| 08 | `repay` | balance note (USDC) + borrow note | residual balance + reduced-debt borrow note |
| 09 | `liquidate` | target borrow note | seized collateral as balance note for liquidator + residual borrow note |
| 10 | `consolidate_balance` | 2-8 balance notes (same token) | one balance note |

Each circuit is ~3-6k constraints. Browser proof time still <10s.

## 5. Multi-operation worked examples

### Example 1 — Power user

```
Day 1: 0xABC deposits 100k USDC + 1 cbBTC → PrivacyEntry
       Public footprint: 1 tx
       Private state: 2 balance notes

Day 1-60: User does 12 operations (supplies, borrows, repays, liquidations)
       Public footprint: 0 (only ZK proofs visible)
       Private state: ~24 commitments created and consumed

Day 60: User withdraws everything to 0xABC
       Public footprint: 1 tx

TOTAL: 2 public touches of 0xABC across 60 days of activity.
```

### Example 2 — Liquidator agent

```
Day 1: Agent's owner funds AgentAccount with 50k USDC and the agent
       deposits it into PrivacyEntry (public: 1 tx)

Day 1-30: Agent wins 47 liquidations, each one:
  - Generates the liquidate proof
  - Submits via the bundler
  - Seizes collateral into a balance note (not to its external address)
  - Optionally converts to USDC via internal swap (a future feature, or external)

Day 30: Agent consolidates 47 balance notes into 1 (consolidate_balance circuit)
       and withdraws to owner's treasury (1 public tx)

TOTAL: 2 public touches per agent lifecycle. 47 wins zero-leakage.
```

### Example 3 — Lender returning multiple times

```
User has 200k to lend, sourced from 3 different incomes over months.

Without PrivacyEntry: each deposit = 1 public tx that reveals their balance growth
With PrivacyEntry: each deposit = 1 public tx, but private operations
                   between deposits don't add to the footprint.
                   Total public deposits = 3 (still)
                   Total public touches = 3 + (1 final withdraw) = 4
                   versus 3 + 4 supplies + 1 withdraw = 8 without PrivacyEntry
```

So PrivacyEntry doesn't *eliminate* the public footprint for users who keep
adding new external capital — it eliminates the **per-operation**
visibility on top of that funding.

## 6. State management for power users

A user with many concurrent positions accumulates many notes:
- One or more balance notes per token (USDC, cbBTC)
- One supply note per supply operation that hasn't been unsupplied
- One active borrow note (their position)

The note-management subsystem (S09) becomes more important:
- The dapp / SDK auto-consolidates balance notes when count > N (default 5).
- The "Positions" view in the dapp groups balance + supply + borrow into
  a unified per-user dashboard, computed locally from decrypted notes.
- Periodic backups recommended; SDK warns user when more than 10 new
  notes since last backup.

## 7. Atomicity considerations

Multi-tree updates (balance tree + supply/borrow tree) happen in a single
tx via the pool contract calling `PrivacyEntry.spendBalance(...)` and then
inserting into its own tree. Both tree updates revert together if the
proof is invalid.

Each operation = single transaction. No multi-tx flows visible to the user.

## 8. Privacy properties (with PrivacyEntry deployed)

| Question | Answer |
|---|---|
| Can chain observer link Day-1 deposit to Day-50 borrow? | **No.** Day-50 borrow is purely a ZK proof + commitment update; the user's wallet never appears. |
| Can they tell the user has been active? | **Only at funding and withdrawal events.** Periods of pure internal activity look like silence from the external wallet. |
| Can they distinguish between "active user" and "user who deposited and forgot"? | Reduced — both look the same on chain until withdrawal. |
| Are amount totals across operations hidden? | Yes. Each operation reveals only the **delta** in its own circuit's public inputs (e.g., a supply circuit reveals "X USDC was supplied," but X is unlinked to the user). |
| Does this change the liquidation discovery model? | No — `LiquidationBoard` still publishes per-position `liquidationPrice` for permissionless liquidator discovery. |
| Are there any new privacy *losses* introduced? | No — strict improvement. |

## 9. Operational notes

- **PrivacyEntry holds the protocol's entire ERC-20 custody.** Critical contract — subject to the deepest audit pass.
- **POOL_ROLE granted only** to `ShieldedSupplyPool` and `ShieldedBorrowPool` at deploy. No EOA ever holds this role.
- **Re-entrancy + Pausable** guards on every external entry.
- **Backup / disaster recovery:** the spending key is the only thing the
  user needs. From it, all their notes (balance + supply + borrow) can be
  reconstructed by scanning the trees. Same recovery story as S09.

## 10. Cost impact

- +1 contract (~400 lines).
- +3 circuits (entry_deposit, entry_withdraw, consolidate_balance).
- 7 existing circuits modified (balance-note semantics).
- +3-4 weeks of implementation.
- +1-2 weeks of audit.
- **Gas per operation:** slightly higher (~30k extra for the cross-contract
  call + extra commitment insertion). Negligible on Horizen L3 economics.

## 11. Dependencies

- All v2 design dependencies (Subsystem 01's contracts, S02's circuits, etc.).
- OpenZeppelin `AccessControl`, `ReentrancyGuard`, `Pausable`.
- The existing zkVerify on-chain verifier proxy.

## 12. Diagram

```mermaid
graph TB
  EOA[0xABC user wallet]
  AGT[AgentAccount]

  subgraph PrivacyEntry (we deploy this — the token vault)
    PE[PrivacyEntry.sol<br/>Merkle tree of balance commitments]
    TOK_USDC[(USDC reserve)]
    TOK_CB[(cbBTC reserve)]
  end

  subgraph Pool contracts (consume + produce balance commitments)
    SP[ShieldedSupplyPool]
    BP[ShieldedBorrowPool]
    LB[LiquidationBoard]
  end

  subgraph Other contracts
    OR[Oracle]
    RM[RateModel]
    IF[InsuranceFund]
    ZV[ZkVerifier]
  end

  ZKP[zkVerify Aggregation Proxy]

  EOA -- "ERC-20 deposit (one-time)" --> PE
  AGT --> PE
  PE -- "ERC-20 withdrawal (one-time)" --> EOA
  PE --> AGT

  PE -- holds --> TOK_USDC
  PE -- holds --> TOK_CB

  SP -- "spendBalance / creditBalance<br/>(POOL_ROLE)" --> PE
  BP -- "spendBalance / creditBalance" --> PE
  LB -- "creditBalance for liquidator" --> PE

  SP --> ZV
  BP --> ZV
  LB --> ZV
  PE --> ZV
  ZV --> ZKP

  BP --> OR
  LB --> OR
  BP --> RM
  SP --> RM
  LB --> IF
```
