//! Shared note structures, hashing, and Merkle helpers for all circuits.
//! Per design-v2 sections 02 (ZK Circuits) and 12 (Privacy Entry Layer).
//!
//! Hashing choice: Poseidon2 on BN254 (the design's original S02 spec). The
//! Day-4 prototype shipped Pedersen as a stopgap because Poseidon had moved
//! out of Noir stdlib. Day-14c (this swap) brings in the canonical
//! `noir-lang/poseidon` library so the contract-side IMT can use a cheap
//! BN254-native Solidity Poseidon2 (~30k gas per hash) instead of an
//! expensive Grumpkin scalar-mul (~100k gas per hash; no EVM precompile).
//! See `memory/project_pedersen_grumpkin_too_expensive.md`.
//!
//! Pinning choices:
//! - Hash: Poseidon2 (`poseidon::poseidon2::Poseidon2::hash`).
//! - MAX_ASSETS = 8 (4 launch assets + 4 future slots).
//! - TREE_DEPTH = 20 (PrivacyEntry + per-pool Merkle trees).
//!
//! Range bounds (enforced wherever values cross into Field arithmetic):
//! - AMOUNT_BITS = 88   (token amounts; max ~3.1e26 wei, vastly above any realistic supply)
//! - INDEX_BITS  = 60   (supply/borrow index; ray-ish but capped per S14 bounds)
//! - PRICE_BITS  = 60   (USD price scaled 1e8; max realistic ~1e12 = 2^40, slack)
//! - BPS_BITS    = 14   (ten-thousandths)

use poseidon::poseidon2::Poseidon2;

/// Local wrapper so the rest of the file reads close to the old
/// `h([...])` calls. Poseidon2::hash takes an explicit
/// message_size in addition to the array; we always pass message_size=N.
fn h<let N: u32>(input: [Field; N]) -> Field {
    Poseidon2::hash(input, N)
}

pub global MAX_ASSETS: u32 = 8;
pub global TREE_DEPTH: u32 = 20;

pub global AMOUNT_BITS: u32 = 88;
pub global INDEX_BITS: u32 = 60;
pub global PRICE_BITS: u32 = 60;
pub global BPS_BITS: u32 = 14;

pub global BPS_DENOM: Field = 10_000;

// --- Note structures -----------------------------------------------------

pub struct BalanceNote {
    pub asset_id: Field,
    pub amount: Field,
    pub spending_pubkey: Field,
    pub salt: Field,
}

pub struct SupplyNote {
    pub asset_id: Field,
    pub amount: Field,
    pub supply_index_at_deposit: Field,
    pub spending_pubkey: Field,
    pub salt: Field,
}

pub struct Position {
    pub spending_pubkey: Field,
    pub collaterals: [Field; MAX_ASSETS],
    pub debts: [Field; MAX_ASSETS],
    pub borrow_indices_at_update: [Field; MAX_ASSETS],
    pub salt: Field,
}

// --- Domain-separation tags ----------------------------------------------

global TAG_BALANCE_NOTE: Field = 1;
global TAG_SUPPLY_NOTE: Field = 2;
global TAG_POSITION_NOTE: Field = 3;
global TAG_SPENDING_PUBKEY: Field = 10;
global TAG_BALANCE_NULLIFIER: Field = 21;
global TAG_SUPPLY_NULLIFIER: Field = 22;
global TAG_POSITION_NULLIFIER: Field = 23;

// --- Commitments ---------------------------------------------------------

pub fn balance_commitment(n: BalanceNote) -> Field {
    h([TAG_BALANCE_NOTE, n.asset_id, n.amount, n.spending_pubkey, n.salt])
}

pub fn supply_commitment(n: SupplyNote) -> Field {
    h(
        [
            TAG_SUPPLY_NOTE,
            n.asset_id,
            n.amount,
            n.supply_index_at_deposit,
            n.spending_pubkey,
            n.salt,
        ],
    )
}

pub fn position_commitment(p: Position) -> Field {
    let mut buf: [Field; 27] = [0; 27];
    buf[0] = TAG_POSITION_NOTE;
    buf[1] = p.spending_pubkey;
    for i in 0..MAX_ASSETS {
        buf[2 + i] = p.collaterals[i];
        buf[2 + MAX_ASSETS + i] = p.debts[i];
        buf[2 + 2 * MAX_ASSETS + i] = p.borrow_indices_at_update[i];
    }
    buf[26] = p.salt;
    h(buf)
}

// --- Spending key + nullifiers -------------------------------------------

pub fn spending_pubkey_of(secret_key: Field) -> Field {
    h([TAG_SPENDING_PUBKEY, secret_key])
}

pub fn balance_nullifier(secret_key: Field, salt: Field) -> Field {
    h([TAG_BALANCE_NULLIFIER, secret_key, salt])
}

pub fn supply_nullifier(secret_key: Field, salt: Field) -> Field {
    h([TAG_SUPPLY_NULLIFIER, secret_key, salt])
}

pub fn position_nullifier(secret_key: Field, salt: Field) -> Field {
    h([TAG_POSITION_NULLIFIER, secret_key, salt])
}

// --- Merkle tree ---------------------------------------------------------

pub fn merkle_root(
    leaf: Field,
    siblings: [Field; TREE_DEPTH],
    index_bits: [bool; TREE_DEPTH],
) -> Field {
    let mut node = leaf;
    for d in 0..TREE_DEPTH {
        let sib = siblings[d];
        let left = if index_bits[d] { sib } else { node };
        let right = if index_bits[d] { node } else { sib };
        node = h([left, right]);
    }
    node
}

// --- Range checks --------------------------------------------------------

/// Constrain `x` to fit in `N` little-endian bits. Equivalent to
/// asserting `0 <= x < 2^N`. Negative-equivalent values (in the field
/// sense) are rejected because they fail the bit decomposition.
pub fn assert_bits<let N: u32>(x: Field) {
    let _bits: [u1; N] = x.to_le_bits();
}

/// Assert `a >= b` using Noir's Field comparison.
pub fn assert_ge(a: Field, b: Field) {
    assert(!a.lt(b));
}

/// Assert `a < b` using Noir's Field comparison.
pub fn assert_lt_field(a: Field, b: Field) {
    assert(a.lt(b));
}

// --- Accrual helpers -----------------------------------------------------

/// Floor-divide `debt * idx_now` by `idx_at_update`. The prover supplies
/// `accrued_debt` and `remainder` as witness hints; the circuit checks
///   debt * idx_now == accrued_debt * idx_at_update + remainder
///   remainder < idx_at_update
/// matching Solidity floor division on the contract side.
///
/// Special case: debt == 0 means no accrual; accrued_debt and remainder
/// must both be 0, and idx_at_update may be 0 (an unused slot).
pub fn check_accrual(
    debt: Field,
    idx_now: Field,
    idx_at_update: Field,
    accrued_debt: Field,
    remainder: Field,
) {
    // Range-check all participants so the multiplications below stay
    // well-defined (< p/2).
    assert_bits::<AMOUNT_BITS>(debt);
    assert_bits::<AMOUNT_BITS>(accrued_debt);
    assert_bits::<INDEX_BITS>(idx_now);
    assert_bits::<INDEX_BITS>(idx_at_update);
    assert_bits::<INDEX_BITS>(remainder);

    // debt * idx_now == accrued_debt * idx_at_update + remainder
    let lhs = debt * idx_now;
    let rhs = accrued_debt * idx_at_update + remainder;
    assert(lhs == rhs);

    // remainder < idx_at_update OR debt == 0 (unused slot).
    // For debt == 0 we expect accrued_debt = 0 and remainder = 0, in which
    // case the equation above is 0 == 0 regardless of idx_at_update.
    // We still require remainder == 0 in the debt==0 case to prevent
    // junk witnesses.
    if debt == 0 {
        assert(accrued_debt == 0);
        assert(remainder == 0);
    } else {
        // idx_at_update must be non-zero for an active debt slot, and
        // remainder must lie strictly below it.
        assert(idx_at_update != 0);
        assert(remainder.lt(idx_at_update));
    }
}

// --- Health-factor check ------------------------------------------------

/// Compute weighted collateral and debt sums and assert
/// `collateral_value >= debt_value`.
///
/// Inputs:
/// - position.collaterals[i], position.debts[i], borrow_indices_at_update[i]
/// - current_prices[i] (USD scaled 1e8)
/// - current_borrow_indices[i]
/// - threshold_bps[i] (LTV when called from borrow/deposit_collateral;
///   LT when called from withdraw_collateral/liquidate)
/// - accrued_debts[i], remainders[i] (witness hints for floor division)
pub fn assert_position_healthy(
    position: Position,
    current_prices: [Field; MAX_ASSETS],
    current_borrow_indices: [Field; MAX_ASSETS],
    threshold_bps: [Field; MAX_ASSETS],
    accrued_debts: [Field; MAX_ASSETS],
    remainders: [Field; MAX_ASSETS],
) {
    let mut collateral_value: Field = 0;
    let mut debt_value: Field = 0;

    for i in 0..MAX_ASSETS {
        // Range-check inputs we touch.
        assert_bits::<AMOUNT_BITS>(position.collaterals[i]);
        assert_bits::<PRICE_BITS>(current_prices[i]);
        assert_bits::<INDEX_BITS>(current_borrow_indices[i]);
        assert_bits::<BPS_BITS>(threshold_bps[i]);

        // Accrual binding: accrued_debts[i] is floor(debt * idx_now / idx_dep).
        check_accrual(
            position.debts[i],
            current_borrow_indices[i],
            position.borrow_indices_at_update[i],
            accrued_debts[i],
            remainders[i],
        );

        // Per-asset weighted collateral: amount * price * threshold_bps.
        collateral_value +=
            position.collaterals[i] * current_prices[i] * threshold_bps[i];

        // Per-asset weighted debt: accrued_debt * price * 10000
        // (cancelling the bps scaling on collateral).
        debt_value += accrued_debts[i] * current_prices[i] * BPS_DENOM;
    }

    assert_ge(collateral_value, debt_value);
}

/// Apply per-asset accrual to a position: refresh debts[i] = accrued_debt[i]
/// and borrow_indices_at_update[i] = current_borrow_indices[i] for every i.
/// Assumes the caller has already run `check_accrual` (typically via
/// `assert_position_healthy`) on the same witness hints.
pub fn apply_accrual(
    mut position: Position,
    accrued_debts: [Field; MAX_ASSETS],
    current_borrow_indices: [Field; MAX_ASSETS],
) -> Position {
    for i in 0..MAX_ASSETS {
        position.debts[i] = accrued_debts[i];
        position.borrow_indices_at_update[i] = current_borrow_indices[i];
    }
    position
}

// --- Trigger derivation -------------------------------------------------

/// Per-asset liquidation trigger price. From S02 section 6:
///
///   trigger[a] = (total_debt_value_at_unit_price[a]
///                  - other_collateral_value_weighted[a])
///                  / (collateral[a] * LT_bps[a])
///
/// All prices held at their current values except for the one being
/// solved for. The "trigger" answers: "at what USD price for asset a
/// would the position go unhealthy?"
///
/// To avoid Field division we pass `trigger_price` as a witness hint
/// per asset and check the equivalent multiplicative relation:
///
///   trigger_price * collateral[a] * LT_bps[a]
///       + other_collateral_value_weighted[a]
///       == total_debt_value_unit_price[a]
///
/// (with `other_collateral_value_weighted` summed using current prices
/// for assets != a, and debt_value computed with accrued amounts).
///
/// `total_debt_unit_value[a]` here is the sum over j of
///   accrued_debt[j] * current_price_or_substitute[j] * 10000
/// where for j == a we substitute "1" (the price we're solving for, in
/// 1e8 units) and for other j we use current_prices[j]. Off-circuit
/// helpers in tests build it the same way.
pub fn check_triggers(
    position: Position,
    current_prices: [Field; MAX_ASSETS],
    lt_bps: [Field; MAX_ASSETS],
    accrued_debts: [Field; MAX_ASSETS],
    triggers: [Field; MAX_ASSETS],
) {
    // For each asset a:
    // 1. If collateral[a] == 0: trigger[a] == 0 (no contribution).
    // 2. Else: enforce the multiplicative relation above with witness `trigger[a]`.
    for a in 0..MAX_ASSETS {
        assert_bits::<PRICE_BITS>(triggers[a]);
        if position.collaterals[a] == 0 {
            assert(triggers[a] == 0);
        } else {
            // Sum contributions from other slots and from debts.
            let mut other_collat_weighted: Field = 0;
            let mut total_debt_weighted: Field = 0;
            for j in 0..MAX_ASSETS {
                if j != a {
                    other_collat_weighted +=
                        position.collaterals[j] * current_prices[j] * lt_bps[j];
                }
                // Debts contribute with price[j] for j != a, and with
                // `triggers[a]` substituted at j == a.
                if j == a {
                    total_debt_weighted +=
                        accrued_debts[j] * triggers[a] * BPS_DENOM;
                } else {
                    total_debt_weighted +=
                        accrued_debts[j] * current_prices[j] * BPS_DENOM;
                }
            }
            let lhs = triggers[a] * position.collaterals[a] * lt_bps[a]
                + other_collat_weighted;
            assert(lhs == total_debt_weighted);
        }
    }
}
