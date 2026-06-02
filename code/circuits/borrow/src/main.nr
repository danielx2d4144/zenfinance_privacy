//! borrow circuit -- S02 sec.2 circuit 08 / S12 circuit 07.
//!
//! Proves: caller owns a Position, increases `debts[asset_id]` by
//! `amount`, and mints a balance note in PrivacyEntry crediting the
//! borrowed funds. The post-borrow position must remain HEALTHY against
//! LTV bps (tighter pre-trade bound than the LT used at liquidation).
//!
//! Public inputs:
//!   - asset_id
//!   - root_position
//!   - old_position_nullifier
//!   - new_position_commitment
//!   - new_balance_commitment
//!   - amount
//!   - current_prices            ([Field; MAX_ASSETS])
//!   - current_borrow_indices    ([Field; MAX_ASSETS])
//!   - ltv_bps                   ([Field; MAX_ASSETS])
//!
//! Private inputs:
//!   - secret_key
//!   - old_position, new_position_salt, new_balance_salt
//!   - merkle_siblings, merkle_index_bits
//!   - accrued_debts, accrual_remainders  (witness hints)

use lib_common::{
    apply_accrual, assert_bits, balance_commitment, BalanceNote,
    assert_position_healthy, merkle_root, Position, position_commitment,
    position_nullifier, spending_pubkey_of, AMOUNT_BITS, MAX_ASSETS, TREE_DEPTH,
};

fn main(
    asset_id: pub Field,
    root_position: pub Field,
    old_position_nullifier_pub: pub Field,
    new_position_commitment: pub Field,
    new_balance_commitment: pub Field,
    amount: pub Field,
    current_prices: pub [Field; MAX_ASSETS],
    current_borrow_indices: pub [Field; MAX_ASSETS],
    ltv_bps: pub [Field; MAX_ASSETS],
    secret_key: Field,
    old_position: Position,
    new_position_salt: Field,
    new_balance_salt: Field,
    merkle_siblings: [Field; TREE_DEPTH],
    merkle_index_bits: [bool; TREE_DEPTH],
    accrued_debts: [Field; MAX_ASSETS],
    accrual_remainders: [Field; MAX_ASSETS],
) {
    assert(secret_key != 0);
    assert(new_position_salt != 0);
    assert(new_balance_salt != 0);
    assert(amount != 0);
    assert_bits::<AMOUNT_BITS>(amount);

    let pk = spending_pubkey_of(secret_key);
    assert(old_position.spending_pubkey == pk);

    let asset_id_u32 = asset_id as u32;
    assert(asset_id_u32 < MAX_ASSETS);

    // 1. Position ownership + Merkle inclusion.
    let old_pos_commit = position_commitment(old_position);
    let computed_root = merkle_root(old_pos_commit, merkle_siblings, merkle_index_bits);
    assert(computed_root == root_position);

    // 2. Nullifier.
    assert(old_position_nullifier_pub == position_nullifier(secret_key, old_position.salt));

    // 3. Accrue per slot via witness hints.
    let mut accrued = apply_accrual(old_position, accrued_debts, current_borrow_indices);

    // 4. Apply borrow to the chosen debt slot.
    let mut new_debts = accrued.debts;
    let mut applied: bool = false;
    for i in 0..MAX_ASSETS {
        let i_field: Field = i as Field;
        if i_field == asset_id {
            let new_debt = accrued.debts[i] + amount;
            assert_bits::<AMOUNT_BITS>(new_debt);
            new_debts[i] = new_debt;
            applied = true;
        }
    }
    assert(applied);
    accrued.debts = new_debts;

    // 5. Build a post-op accrual witness: same per-slot accrued figures
    //    EXCEPT the borrowed asset, which is now `accrued_debts[id] + amount`
    //    and shares the freshly-snapshot index, so its in-circuit remainder
    //    stays 0 (idx_at_update == current_borrow_indices for that slot).
    let mut post_accrued: [Field; MAX_ASSETS] = accrued_debts;
    let mut post_remainders: [Field; MAX_ASSETS] = accrual_remainders;
    for i in 0..MAX_ASSETS {
        let i_field: Field = i as Field;
        if i_field == asset_id {
            post_accrued[i] = accrued.debts[i];
            post_remainders[i] = 0;
        }
    }

    // 6. Post-borrow HF check vs LTV.
    assert_position_healthy(
        accrued,
        current_prices,
        current_borrow_indices,
        ltv_bps,
        post_accrued,
        post_remainders,
    );

    // 7. New commitment with fresh salt.
    accrued.salt = new_position_salt;
    assert(new_position_commitment == position_commitment(accrued));

    // 8. Credit balance note for borrowed funds.
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
fn empty_bits() -> [bool; TREE_DEPTH] { [false; TREE_DEPTH] }

#[test]
fn test_first_borrow_against_collateral() {
    let secret_key: Field = 0xdead;
    let pk = spending_pubkey_of(secret_key);

    // Start: 100k collat in slot 0, no debt.
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[0] = 100_000;
    let debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let old_position = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts,
        borrow_indices_at_update: idxs,
        salt: 0xa,
    };
    let old_commit = position_commitment(old_position);
    let sibs = empty_siblings();
    let bits = empty_bits();
    let root = merkle_root(old_commit, sibs, bits);
    let null = position_nullifier(secret_key, old_position.salt);

    let mut prices: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    prices[0] = 100_000_000;  // $1
    prices[1] = 100_000_000;
    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs_now[1] = 1_000_000_000;  // index baseline
    let mut ltv_bps: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    ltv_bps[0] = 8_000;
    ltv_bps[1] = 8_000;

    // No prior debt: accrued = 0, remainder = 0 for all.
    let accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    // Borrow 50k of asset 1.
    // Post: collat 100k*$1*8000 = 800m; debt 50k*$1*10000 = 500m -> healthy.
    let new_pos_salt: Field = 0xb;
    let mut new_debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    new_debts[1] = 50_000;
    let mut new_idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    new_idxs[1] = 1_000_000_000;
    let new_position = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts: new_debts,
        borrow_indices_at_update: new_idxs,
        salt: new_pos_salt,
    };
    let new_pos_commit = position_commitment(new_position);

    let new_balance_salt: Field = 0xc;
    let new_balance = BalanceNote {
        asset_id: 1,
        amount: 50_000,
        spending_pubkey: pk,
        salt: new_balance_salt,
    };
    let new_balance_commit = balance_commitment(new_balance);

    main(
        1, root, null, new_pos_commit, new_balance_commit,
        50_000, prices, idxs_now, ltv_bps,
        secret_key, old_position, new_pos_salt, new_balance_salt,
        sibs, bits, accrued, remainders,
    );
}

#[test(should_fail)]
fn test_over_ltv_borrow_rejected() {
    let secret_key: Field = 0xdead;
    let pk = spending_pubkey_of(secret_key);
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[0] = 100_000;
    let debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let old_position = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts,
        borrow_indices_at_update: idxs,
        salt: 0xa,
    };
    let old_commit = position_commitment(old_position);
    let sibs = empty_siblings();
    let bits = empty_bits();
    let root = merkle_root(old_commit, sibs, bits);
    let null = position_nullifier(secret_key, old_position.salt);

    let mut prices: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    prices[0] = 100_000_000;
    prices[1] = 100_000_000;
    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs_now[1] = 1_000_000_000;
    let mut ltv_bps: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    ltv_bps[0] = 8_000;
    ltv_bps[1] = 8_000;

    let accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    // Borrow 90k of asset 1: weighted_debt = 90k*1*10000 = 900m,
    // weighted_collat = 100k*1*8000 = 800m -> unhealthy.
    let new_pos_salt: Field = 0xb;
    let mut new_debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    new_debts[1] = 90_000;
    let mut new_idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    new_idxs[1] = 1_000_000_000;
    let new_position = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts: new_debts,
        borrow_indices_at_update: new_idxs,
        salt: new_pos_salt,
    };
    let new_pos_commit = position_commitment(new_position);

    let new_balance_salt: Field = 0xc;
    let new_balance = BalanceNote {
        asset_id: 1, amount: 90_000, spending_pubkey: pk, salt: new_balance_salt,
    };
    let new_balance_commit = balance_commitment(new_balance);

    main(
        1, root, null, new_pos_commit, new_balance_commit,
        90_000, prices, idxs_now, ltv_bps,
        secret_key, old_position, new_pos_salt, new_balance_salt,
        sibs, bits, accrued, remainders,
    );
}

#[test(should_fail)]
fn test_wrong_balance_commit_rejected() {
    let secret_key: Field = 0xdead;
    let pk = spending_pubkey_of(secret_key);
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[0] = 100_000;
    let debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let old_position = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts,
        borrow_indices_at_update: idxs,
        salt: 0xa,
    };
    let old_commit = position_commitment(old_position);
    let sibs = empty_siblings();
    let bits = empty_bits();
    let root = merkle_root(old_commit, sibs, bits);
    let null = position_nullifier(secret_key, old_position.salt);

    let mut prices: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    prices[0] = 100_000_000;
    prices[1] = 100_000_000;
    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs_now[1] = 1_000_000_000;
    let mut ltv_bps: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    ltv_bps[0] = 8_000;
    ltv_bps[1] = 8_000;
    let accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    let mut new_debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    new_debts[1] = 50_000;
    let mut new_idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    new_idxs[1] = 1_000_000_000;
    let new_pos_salt: Field = 0xb;
    let new_position = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts: new_debts,
        borrow_indices_at_update: new_idxs,
        salt: new_pos_salt,
    };
    let new_pos_commit = position_commitment(new_position);

    let new_balance_salt: Field = 0xc;
    // Wrong: credit 99k via balance commit while public amount is 50k.
    let bad_balance =
        BalanceNote { asset_id: 1, amount: 99_000, spending_pubkey: pk, salt: new_balance_salt };
    let bad_balance_commit = balance_commitment(bad_balance);

    main(
        1, root, null, new_pos_commit, bad_balance_commit,
        50_000, prices, idxs_now, ltv_bps,
        secret_key, old_position, new_pos_salt, new_balance_salt,
        sibs, bits, accrued, remainders,
    );
}
