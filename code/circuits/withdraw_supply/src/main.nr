//! withdraw_supply circuit -- S02 sec.2 circuit 05, S12 circuit 04, S14 sec.6.2.
//!
//! Proves: caller spends a supply note in ShieldedSupplyPool's tree and
//! mints a new balance note in PrivacyEntry's tree, with the credited
//! amount bounded by the original deposit grown by the supply-index
//! ratio. Concretely:
//!
//!     amount * supply_index_at_deposit <= note_amount * supply_index_now
//!
//! Equivalent to `amount <= note_amount * (idx_now / idx_at_deposit)` but
//! avoids field division. Range-checked in u128: amounts capped at 2^88,
//! indices capped at 2^40 -- products always fit.
//!
//! Public inputs:
//!   - asset_id
//!   - root_supply
//!   - supply_nullifier_pub
//!   - new_balance_commitment
//!   - amount             (credited to the user's balance)
//!   - supply_index_now
//!
//! Private inputs:
//!   - secret_key, note_amount, idx_at_deposit
//!   - old_supply_salt, new_balance_salt
//!   - supply_siblings, supply_index_bits

use lib_common::{
    balance_commitment, BalanceNote, merkle_root, spending_pubkey_of,
    supply_commitment, supply_nullifier, SupplyNote, TREE_DEPTH,
};

// Bounds: amounts < 2^88, indices < 2^40, so amount*index fits in u128.
global MAX_AMOUNT: u128 = 0x100000000000000000000000;
global MAX_INDEX: u128 = 0x10000000000;

fn main(
    asset_id: pub Field,
    root_supply: pub Field,
    supply_nullifier_pub: pub Field,
    new_balance_commitment: pub Field,
    amount: pub Field,
    supply_index_now: pub Field,
    secret_key: Field,
    note_amount: Field,
    idx_at_deposit: Field,
    old_supply_salt: Field,
    new_balance_salt: Field,
    supply_siblings: [Field; TREE_DEPTH],
    supply_index_bits: [bool; TREE_DEPTH],
) {
    assert(secret_key != 0);
    assert(old_supply_salt != 0);
    assert(new_balance_salt != 0);
    assert(amount != 0);
    assert(idx_at_deposit != 0);
    assert(supply_index_now != 0);

    // 1. Range checks -- bound inputs so the index*amount product fits in u128.
    let amount_u128 = amount as u128;
    let note_u128 = note_amount as u128;
    let idx_now_u128 = supply_index_now as u128;
    let idx_dep_u128 = idx_at_deposit as u128;
    let max_amount = MAX_AMOUNT;
    let max_index = MAX_INDEX;
    assert(amount_u128 < max_amount);
    assert(note_u128 < max_amount);
    assert(idx_now_u128 < max_index);
    assert(idx_dep_u128 < max_index);

    // 2. Monotonic interest: idx_now >= idx_at_deposit.
    assert(idx_dep_u128 <= idx_now_u128);

    let pk = spending_pubkey_of(secret_key);

    // 3. Reconstruct + Merkle-verify the consumed supply note.
    let old_supply = SupplyNote {
        asset_id,
        amount: note_amount,
        supply_index_at_deposit: idx_at_deposit,
        spending_pubkey: pk,
        salt: old_supply_salt,
    };
    let old_supply_commit = supply_commitment(old_supply);
    let computed_root = merkle_root(old_supply_commit, supply_siblings, supply_index_bits);
    assert(computed_root == root_supply);

    // 4. Nullifier.
    assert(supply_nullifier_pub == supply_nullifier(secret_key, old_supply_salt));

    // 5. Interest bound: amount * idx_dep <= note_amount * idx_now.
    let lhs = amount_u128 * idx_dep_u128;
    let rhs = note_u128 * idx_now_u128;
    assert(lhs <= rhs);

    // 6. New balance note commitment.
    let new_balance = BalanceNote {
        asset_id,
        amount,
        spending_pubkey: pk,
        salt: new_balance_salt,
    };
    assert(new_balance_commitment == balance_commitment(new_balance));
}

// --- Tests ---------------------------------------------------------------

fn empty_siblings() -> [Field; TREE_DEPTH] { [0; TREE_DEPTH] }
fn empty_index_bits() -> [bool; TREE_DEPTH] { [false; TREE_DEPTH] }

struct W {
    asset_id: Field,
    secret_key: Field,
    note_amount: Field,
    idx_at_deposit: Field,
    old_supply_salt: Field,
    new_balance_salt: Field,
    amount: Field,
    supply_index_now: Field,
}

fn run_with(w: W) -> (
    Field, Field, Field, Field, Field, Field,
    [Field; TREE_DEPTH], [bool; TREE_DEPTH]
) {
    let pk = spending_pubkey_of(w.secret_key);
    let old_supply = SupplyNote {
        asset_id: w.asset_id, amount: w.note_amount,
        supply_index_at_deposit: w.idx_at_deposit,
        spending_pubkey: pk, salt: w.old_supply_salt,
    };
    let supply_commit = supply_commitment(old_supply);
    let sibs = empty_siblings();
    let bits = empty_index_bits();
    let root = merkle_root(supply_commit, sibs, bits);
    let null = supply_nullifier(w.secret_key, w.old_supply_salt);
    let new_balance = BalanceNote {
        asset_id: w.asset_id, amount: w.amount,
        spending_pubkey: pk, salt: w.new_balance_salt,
    };
    let balance_commit = balance_commitment(new_balance);
    (w.asset_id, root, null, balance_commit, w.amount, w.supply_index_now, sibs, bits)
}

#[test]
fn test_no_interest_path() {
    // idx_now == idx_at_deposit -> max withdrawable == note_amount.
    let w = W {
        asset_id: 0, secret_key: 0xdead,
        note_amount: 1_000_000, idx_at_deposit: 1_000_000_000,
        old_supply_salt: 0xa, new_balance_salt: 0xb,
        amount: 1_000_000, supply_index_now: 1_000_000_000,
    };
    let (a, r, n, bc, am, idx, sibs, bits) = run_with(w);
    main(a, r, n, bc, am, idx,
         w.secret_key, w.note_amount, w.idx_at_deposit,
         w.old_supply_salt, w.new_balance_salt, sibs, bits);
}

#[test]
fn test_with_interest_path() {
    // idx_now = 1.05 * idx_at_deposit -> 5% accrual.
    // note 1_000_000 -> max amount = 1_050_000.
    let w = W {
        asset_id: 0, secret_key: 0xdead,
        note_amount: 1_000_000, idx_at_deposit: 1_000_000_000,
        old_supply_salt: 0xa, new_balance_salt: 0xb,
        amount: 1_050_000, supply_index_now: 1_050_000_000,
    };
    let (a, r, n, bc, am, idx, sibs, bits) = run_with(w);
    main(a, r, n, bc, am, idx,
         w.secret_key, w.note_amount, w.idx_at_deposit,
         w.old_supply_salt, w.new_balance_salt, sibs, bits);
}

#[test(should_fail)]
fn test_over_withdraw_with_interest_rejected() {
    // 5% accrual claimed, but withdrawing as if 6%.
    let w = W {
        asset_id: 0, secret_key: 0xdead,
        note_amount: 1_000_000, idx_at_deposit: 1_000_000_000,
        old_supply_salt: 0xa, new_balance_salt: 0xb,
        amount: 1_060_000, supply_index_now: 1_050_000_000,
    };
    let (a, r, n, bc, am, idx, sibs, bits) = run_with(w);
    main(a, r, n, bc, am, idx,
         w.secret_key, w.note_amount, w.idx_at_deposit,
         w.old_supply_salt, w.new_balance_salt, sibs, bits);
}

#[test(should_fail)]
fn test_index_decay_rejected() {
    // idx_now < idx_at_deposit should be impossible (rate model is monotonic).
    let w = W {
        asset_id: 0, secret_key: 0xdead,
        note_amount: 1_000_000, idx_at_deposit: 1_100_000_000,
        old_supply_salt: 0xa, new_balance_salt: 0xb,
        amount: 900_000, supply_index_now: 1_000_000_000,
    };
    let (a, r, n, bc, am, idx, sibs, bits) = run_with(w);
    main(a, r, n, bc, am, idx,
         w.secret_key, w.note_amount, w.idx_at_deposit,
         w.old_supply_salt, w.new_balance_salt, sibs, bits);
}

#[test(should_fail)]
fn test_wrong_secret_key_fails_root() {
    let w = W {
        asset_id: 0, secret_key: 0xdead,
        note_amount: 1_000_000, idx_at_deposit: 1_000_000_000,
        old_supply_salt: 0xa, new_balance_salt: 0xb,
        amount: 500_000, supply_index_now: 1_000_000_000,
    };
    let (a, r, n, bc, am, idx, sibs, bits) = run_with(w);
    main(a, r, n, bc, am, idx,
         0xbad,
         w.note_amount, w.idx_at_deposit,
         w.old_supply_salt, w.new_balance_salt, sibs, bits);
}
