//! supply_asset circuit -- S02 sec.2 circuit 04, S12 circuit 03.
//!
//! Proves: caller spends a balance note in PrivacyEntry's tree and mints
//! a supply note in ShieldedSupplyPool's tree. The amount-to-supply may
//! be a partial slice; any remainder stays as a residual balance note.
//!
//! On-chain: `ShieldedSupplyPool.supply(...)` calls
//! `PrivacyEntry.spendBalance(...)` which inserts the residual balance,
//! then inserts the supply commitment locally.
//!
//! Public inputs:
//!   - asset_id
//!   - root_balance         (PrivacyEntry root)
//!   - balance_nullifier    (consumed balance note)
//!   - residual_balance_commitment
//!   - supply_commitment    (new supply note)
//!   - amount               (slice routed into supply)
//!   - supply_index_now     (the pool's current supplyIndex; pinned in note)
//!
//! Private inputs:
//!   - secret_key
//!   - old_balance_amount, old_balance_salt
//!   - new_balance_salt, new_supply_salt
//!   - balance_siblings, balance_index_bits

use lib_common::{
    balance_commitment, balance_nullifier, BalanceNote, merkle_root,
    spending_pubkey_of, supply_commitment, SupplyNote, TREE_DEPTH,
};

fn main(
    asset_id: pub Field,
    root_balance: pub Field,
    balance_nullifier_pub: pub Field,
    residual_balance_commitment: pub Field,
    supply_commitment_pub: pub Field,
    amount: pub Field,
    supply_index_now: pub Field,
    secret_key: Field,
    old_balance_amount: Field,
    old_balance_salt: Field,
    new_balance_salt: Field,
    new_supply_salt: Field,
    balance_siblings: [Field; TREE_DEPTH],
    balance_index_bits: [bool; TREE_DEPTH],
) {
    assert(secret_key != 0);
    assert(old_balance_salt != 0);
    assert(new_balance_salt != 0);
    assert(new_supply_salt != 0);
    assert(amount != 0);
    assert(supply_index_now != 0);

    let pk = spending_pubkey_of(secret_key);

    // 1. Balance note ownership + Merkle inclusion.
    let old_balance = BalanceNote {
        asset_id,
        amount: old_balance_amount,
        spending_pubkey: pk,
        salt: old_balance_salt,
    };
    let old_balance_commit = balance_commitment(old_balance);
    let computed_root = merkle_root(old_balance_commit, balance_siblings, balance_index_bits);
    assert(computed_root == root_balance);

    // 2. Nullifier.
    assert(balance_nullifier_pub == balance_nullifier(secret_key, old_balance_salt));

    // 3. Conservation: amount <= old_balance_amount.
    let old_u128 = old_balance_amount as u128;
    let amount_u128 = amount as u128;
    assert(amount_u128 <= old_u128);
    let residual_amount = old_balance_amount - amount;

    // 4. Residual balance note commitment.
    let residual = BalanceNote {
        asset_id,
        amount: residual_amount,
        spending_pubkey: pk,
        salt: new_balance_salt,
    };
    assert(residual_balance_commitment == balance_commitment(residual));

    // 5. New supply note pins the current supplyIndex (so withdraw_supply
    //    can later compute interest as amount * idx_now / idx_at_deposit).
    let supply = SupplyNote {
        asset_id,
        amount,
        supply_index_at_deposit: supply_index_now,
        spending_pubkey: pk,
        salt: new_supply_salt,
    };
    assert(supply_commitment_pub == supply_commitment(supply));
}

// --- Tests ---------------------------------------------------------------

fn empty_siblings() -> [Field; TREE_DEPTH] { [0; TREE_DEPTH] }
fn empty_index_bits() -> [bool; TREE_DEPTH] { [false; TREE_DEPTH] }

struct W {
    asset_id: Field,
    secret_key: Field,
    old_balance_amount: Field,
    old_balance_salt: Field,
    new_balance_salt: Field,
    new_supply_salt: Field,
    amount: Field,
    supply_index_now: Field,
}

fn run_with(w: W) -> (
    Field, Field, Field, Field, Field, Field, Field,
    [Field; TREE_DEPTH], [bool; TREE_DEPTH]
) {
    let pk = spending_pubkey_of(w.secret_key);
    let old_balance = BalanceNote {
        asset_id: w.asset_id, amount: w.old_balance_amount,
        spending_pubkey: pk, salt: w.old_balance_salt,
    };
    let old_commit = balance_commitment(old_balance);
    let sibs = empty_siblings();
    let bits = empty_index_bits();
    let root = merkle_root(old_commit, sibs, bits);
    let null = balance_nullifier(w.secret_key, w.old_balance_salt);
    let residual = BalanceNote {
        asset_id: w.asset_id, amount: w.old_balance_amount - w.amount,
        spending_pubkey: pk, salt: w.new_balance_salt,
    };
    let residual_commit = balance_commitment(residual);
    let supply = SupplyNote {
        asset_id: w.asset_id, amount: w.amount,
        supply_index_at_deposit: w.supply_index_now,
        spending_pubkey: pk, salt: w.new_supply_salt,
    };
    let supply_commit = supply_commitment(supply);
    (w.asset_id, root, null, residual_commit, supply_commit, w.amount, w.supply_index_now, sibs, bits)
}

#[test]
fn test_happy_path_partial_supply() {
    let w = W {
        asset_id: 0, secret_key: 0xdead,
        old_balance_amount: 1_000_000, old_balance_salt: 0xa,
        new_balance_salt: 0xb, new_supply_salt: 0xc,
        amount: 400_000, supply_index_now: 1_050_000_000_000_000_000,
    };
    let (a, r, n, rc, sc, am, idx, sibs, bits) = run_with(w);
    main(a, r, n, rc, sc, am, idx,
         w.secret_key, w.old_balance_amount, w.old_balance_salt,
         w.new_balance_salt, w.new_supply_salt, sibs, bits);
}

#[test]
fn test_happy_path_full_supply() {
    let w = W {
        asset_id: 1, secret_key: 0xfeed,
        old_balance_amount: 500_000, old_balance_salt: 0x10,
        new_balance_salt: 0x20, new_supply_salt: 0x30,
        amount: 500_000, supply_index_now: 1_000_000_000_000_000_000,
    };
    let (a, r, n, rc, sc, am, idx, sibs, bits) = run_with(w);
    main(a, r, n, rc, sc, am, idx,
         w.secret_key, w.old_balance_amount, w.old_balance_salt,
         w.new_balance_salt, w.new_supply_salt, sibs, bits);
}

#[test(should_fail)]
fn test_over_supply_rejected() {
    let w = W {
        asset_id: 0, secret_key: 0xdead,
        old_balance_amount: 1_000, old_balance_salt: 0xa,
        new_balance_salt: 0xb, new_supply_salt: 0xc,
        amount: 1_001, supply_index_now: 1_000_000_000_000_000_000,
    };
    // Synthetic public inputs with the wrong amount but otherwise consistent.
    let pk = spending_pubkey_of(w.secret_key);
    let old_balance = BalanceNote {
        asset_id: w.asset_id, amount: w.old_balance_amount,
        spending_pubkey: pk, salt: w.old_balance_salt,
    };
    let old_commit = balance_commitment(old_balance);
    let sibs = empty_siblings();
    let bits = empty_index_bits();
    let root = merkle_root(old_commit, sibs, bits);
    let null = balance_nullifier(w.secret_key, w.old_balance_salt);
    // Build the residual using over-large amount; its commitment will still
    // match itself, but the u128 conservation check should fire first.
    let residual = BalanceNote {
        asset_id: w.asset_id, amount: w.old_balance_amount - w.amount,
        spending_pubkey: pk, salt: w.new_balance_salt,
    };
    let residual_commit = balance_commitment(residual);
    let supply = SupplyNote {
        asset_id: w.asset_id, amount: w.amount,
        supply_index_at_deposit: w.supply_index_now,
        spending_pubkey: pk, salt: w.new_supply_salt,
    };
    let supply_commit = supply_commitment(supply);
    main(w.asset_id, root, null, residual_commit, supply_commit, w.amount,
         w.supply_index_now,
         w.secret_key, w.old_balance_amount, w.old_balance_salt,
         w.new_balance_salt, w.new_supply_salt, sibs, bits);
}

#[test(should_fail)]
fn test_supply_commitment_drifts_index() {
    let w = W {
        asset_id: 0, secret_key: 0xdead,
        old_balance_amount: 1_000, old_balance_salt: 0xa,
        new_balance_salt: 0xb, new_supply_salt: 0xc,
        amount: 500, supply_index_now: 1_050_000_000_000_000_000,
    };
    let (a, r, n, rc, _sc, am, idx, sibs, bits) = run_with(w);
    // Forge a supply commitment that bakes in a different (smaller) index;
    // the circuit should detect commitment mismatch.
    let pk = spending_pubkey_of(w.secret_key);
    let bad = SupplyNote {
        asset_id: w.asset_id, amount: w.amount,
        supply_index_at_deposit: 1_000_000_000_000_000_000,
        spending_pubkey: pk, salt: w.new_supply_salt,
    };
    let bad_commit = supply_commitment(bad);
    main(a, r, n, rc, bad_commit, am, idx,
         w.secret_key, w.old_balance_amount, w.old_balance_salt,
         w.new_balance_salt, w.new_supply_salt, sibs, bits);
}

#[test(should_fail)]
fn test_zero_amount_rejected() {
    let w = W {
        asset_id: 0, secret_key: 0xdead,
        old_balance_amount: 1_000, old_balance_salt: 0xa,
        new_balance_salt: 0xb, new_supply_salt: 0xc,
        amount: 0, supply_index_now: 1_000_000_000_000_000_000,
    };
    let (a, r, n, rc, sc, am, idx, sibs, bits) = run_with(w);
    main(a, r, n, rc, sc, am, idx,
         w.secret_key, w.old_balance_amount, w.old_balance_salt,
         w.new_balance_salt, w.new_supply_salt, sibs, bits);
}
