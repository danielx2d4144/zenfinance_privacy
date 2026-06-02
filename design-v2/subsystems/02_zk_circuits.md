# Subsystem 02 — ZK Circuits

## 1. Purpose

The **Noir circuits** that enforce every state transition in the protocol.
Each circuit proves a specific operation is valid against current public
state (per-asset indices, prices, Merkle roots) and a private witness
(notes + amounts).

**Multi-asset by parameterization.** Most circuits take an `assetId` (or a
pair `(collateralAsset, debtAsset)`) as a public input and operate on the
relevant slot inside a multi-asset position. The Merkle commitment scheme
itself is asset-agnostic — what changes is the witness structure.

Toolchain: **Noir + Barretenberg (`bb`) v3.x**, UltraHonk-ZK flavour with
Keccak transcript — the configuration that zkVerify's UltraHonk pallet
supports today.

## 2. The circuit set (12 circuits)

| # | Circuit | Purpose | Parameterization | ~constraints |
|---|---|---|---|---|
| 01 | `entry_deposit` | External tokens → balance note in PrivacyEntry | `(assetId)` | ~2k |
| 02 | `entry_withdraw` | Balance note → external recipient | `(assetId)` | ~3k |
| 03 | `consolidate_balance` | Merge 2–8 same-asset balance notes → 1 | `(assetId)` | ~5k |
| 04 | `supply_asset` | Balance note → supply note for that asset | `(assetId)` | ~4k |
| 05 | `withdraw_supply` | Supply note → balance note (interest accrued) | `(assetId)` | ~5k |
| 06 | `deposit_collateral` | Balance note → adds collateral slot to position | `(collateralAsset)` | ~9k |
| 07 | `withdraw_collateral` | Removes/reduces collateral slot; checks remaining HF | `(collateralAsset)` | ~12k |
| 08 | `borrow` | Adds debt slot or increases existing debt; checks HF | `(debtAsset)` | ~13k |
| 09 | `repay` | Reduces debt slot; balance note in `debtAsset` consumed | `(debtAsset)` | ~10k |
| 10 | `liquidate` | Seizes `(collateralAsset)` against repaying `(debtAsset)` | `(collateralAsset, debtAsset)` | ~15k |
| 11 | `compute_triggers` | Helper proof: given a position, derive the per-asset trigger array | — | ~6k |
| 12 | `bucket_refresh` (optional, v1.5) | Borrower proves their position is in a public HF bucket | — | ~5k |

Total: ~90k constraints across all circuits. Browser prove-time of the
biggest single circuit (`liquidate` at 15k constraints) is ~8-12s on a
mid-spec laptop with `bb.js`.

## 3. The multi-asset position structure

The single most important data shape across the protocol. Used by circuits
06-11.

```rust
// In Noir (sketch — actual implementation uses fixed-length arrays)
struct Position {
    spending_pubkey: Field,
    collaterals: [Field; MAX_ASSETS],          // index = assetId; 0 if unused
    debts: [Field; MAX_ASSETS],                // index = assetId; 0 if unused
    borrowIndices_at_update: [Field; MAX_ASSETS], // snapshot for accrual
    salt: Field,
}

// Position commitment = Poseidon hash of all fields, packed.
// MAX_ASSETS = 8 (room for 4 launch assets + 4 future).
```

## 4. Multi-asset health-factor formula (verified inside every relevant circuit)

```rust
fn assert_position_healthy(
    position: Position,
    current_prices: [Field; MAX_ASSETS],
    current_borrowIndices: [Field; MAX_ASSETS],
    LTV_bps: [Field; MAX_ASSETS],
    LIQ_THRESHOLD_bps: [Field; MAX_ASSETS],
) {
    let mut collateral_value: Field = 0;
    let mut debt_value: Field = 0;

    for i in 0..MAX_ASSETS {
        // Per-asset collateral contribution (weighted by liquidation threshold)
        collateral_value += position.collaterals[i]
            * current_prices[i]
            * LIQ_THRESHOLD_bps[i];

        // Per-asset debt with interest accrual
        let accrued_debt = position.debts[i]
            * current_borrowIndices[i]
            / position.borrowIndices_at_update[i];

        debt_value += accrued_debt * current_prices[i] * 10_000;
        // (multiplied by 10_000 to cancel the bps scaling on collateral)
    }

    // HF = collateral_value / debt_value ≥ 1.0
    assert(collateral_value >= debt_value);
}
```

This formula is reused (with slight variants — e.g., LTV vs LT — depending
on op) across `deposit_collateral`, `withdraw_collateral`, `borrow`,
`repay`, and `liquidate`.

## 5. Example: `borrow` circuit (witness + public inputs)

```rust
fn main(
    // ── private ──
    old_position: Position,
    secret_key: Field,
    merkle_path_old: [Field; TREE_DEPTH],
    new_salt: Field,
    old_balance_note: BalanceNote,   // balance note in PrivacyEntry to credit borrowed amount
    balance_merkle_path: [Field; TREE_DEPTH],
    new_balance_salt: Field,

    // ── public ──
    debt_asset_id: pub Field,        // which asset we're borrowing
    old_position_nullifier: pub Field,
    new_position_commitment: pub Field,
    new_balance_commitment: pub Field,  // credited to user's PrivacyEntry
    amount_borrowed: pub Field,
    current_prices: pub [Field; MAX_ASSETS],
    current_borrowIndices: pub [Field; MAX_ASSETS],
    LTV_bps: pub [Field; MAX_ASSETS],
    LIQ_THRESHOLD_bps: pub [Field; MAX_ASSETS],
    new_liquidation_triggers: pub [Field; MAX_ASSETS],
) {
    // 1. spending key authenticates
    assert(Poseidon([secret_key]).hash() == old_position.spending_pubkey);

    // 2. nullifier matches
    assert(old_position_nullifier == Poseidon([secret_key, old_position.salt]).hash());

    // 3. position is in the tree
    let computed_root = merkle_root(merkle_path_old, hash(old_position));
    // contract checks computed_root ∈ rootHistory

    // 4. accrue per-asset debt
    let mut new_position = old_position;
    for i in 0..MAX_ASSETS {
        if old_position.debts[i] > 0 {
            new_position.debts[i] = old_position.debts[i]
                * current_borrowIndices[i]
                / old_position.borrowIndices_at_update[i];
        }
        new_position.borrowIndices_at_update[i] = current_borrowIndices[i];
    }

    // 5. apply the borrow to the named asset
    new_position.debts[debt_asset_id] += amount_borrowed;

    // 6. LTV check (use LTV, not LT — borrow-time check is tighter than liq check)
    assert_position_healthy(new_position, current_prices, current_borrowIndices,
                           LTV_bps, LTV_bps);  // both bounds = LTV

    // 7. new commitment matches new position
    new_position.salt = new_salt;
    assert(new_position_commitment == hash(new_position));

    // 8. derive new triggers (one per non-zero collateral)
    // ... computed and asserted equal to `new_liquidation_triggers`

    // 9. credit balance note for borrowed amount
    let new_balance = BalanceNote {
        asset_id: debt_asset_id,
        amount: old_balance_note.amount + amount_borrowed,
        spending_pubkey: old_position.spending_pubkey,
        salt: new_balance_salt,
    };
    assert(new_balance_commitment == hash(new_balance));
}
```

## 6. Liquidation trigger derivation

Each position publishes per-asset trigger prices on `LiquidationBoard`.
Derivation (assuming worst case — other asset prices stay constant):

```rust
fn derive_trigger_for_asset(
    position: Position,
    asset_id: u8,
    other_prices: [Field; MAX_ASSETS],   // current prices for assets ≠ asset_id
    LT_bps: [Field; MAX_ASSETS],
    current_borrowIndices: [Field; MAX_ASSETS],
) -> Field {
    // Trigger = price at which collateral_value × LT == debt_value
    // Solving for price[asset_id]:

    let mut other_collateral_value: Field = 0;
    let mut total_debt_value: Field = 0;

    for i in 0..MAX_ASSETS {
        if i != asset_id {
            other_collateral_value += position.collaterals[i] * other_prices[i] * LT_bps[i];
        }
        total_debt_value += position.debts[i]
            * other_prices[i]
            * current_borrowIndices[i] / position.borrowIndices_at_update[i]
            * 10_000;
    }

    // Solve: collat[asset_id] * price * LT_bps[asset_id] + other_collateral_value = total_debt_value
    let trigger = (total_debt_value - other_collateral_value)
        / (position.collaterals[asset_id] * LT_bps[asset_id]);

    trigger  // assert published value equals this
}
```

Produces one trigger per non-zero collateral slot. The `LiquidationBoard`
stores the full array per position.

## 7. Statement-hash recipe (unchanged from v2)

Each circuit's statement hash for `verifyProofAggregation`:

```
leaf = keccak256(
    keccak256("ultrahonk") || vkHash || sha256("ultrahonk:v3.0") || keccak256(pubs_bytes)
)
```

`pubs_bytes` is the abi-encoded concatenation of the circuit's public
inputs in declaration order. We register all 12 circuits' VKs with
zkVerify at deploy time.

## 8. Build pipeline

Same as v2:

```bash
# per-circuit
nargo execute
bb prove -t evm -b ./target/<circuit>.json -w ./target/<circuit>.gz -o ./target  # ZK
bb write_vk -t evm -b ./target/<circuit>.json -o ./target

# pack to zkVerify-compatible hex
./scripts/pack_zkv.sh ZK
```

Build all 12 inside the pinned Docker (S11).

## 9. Privacy properties

- Each circuit reveals only the declared public inputs.
- Multi-asset position structure stays in the witness; only changes to
  triggers + asset-specific amounts (the operation's "delta") become
  public.
- Cross-asset structure leak: an observer sees `liquidation_triggers`
  per asset, which (combined with current prices) lets them infer
  the rough ratio of each collateral to total debt — but not absolute
  amounts.

## 10. Agent accessibility notes

- Circuits compile to fixed WASM bundles; same code runs in browser
  (`@aztec/bb.js`) and Node SDK / MCP server's server-side prover.
- Each circuit's witness is constructed deterministically from
  `(currentPosition, oldBalance, asset_id, amount, currentPrices,
  currentIndices)` — agent can recompute on retry, getting an identical
  proof (idempotency guarantee).

## 11. Dependencies

- Noir + `noirup` + `nargo`.
- `bb` v3.x + `bbup`.
- `barretenberg` library.
- ZK-circuit-focused auditor (Veridise / Zellic / Trail of Bits).

