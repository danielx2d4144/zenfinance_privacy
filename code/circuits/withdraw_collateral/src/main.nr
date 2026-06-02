//! withdraw_collateral circuit -- S02 sec.2 circuit 07.
//!
//! Proves: caller owns a Position in ShieldedPositionPool's tree, reduces
//! `collateral[asset_id]` by `amount`, and mints a new balance note in
//! PrivacyEntry crediting the withdrawn amount. The post-withdraw
//! position must remain HEALTHY against the liquidation-threshold (LT)
//! bps -- this is the tighter, post-op solvency check.
//!
//! On-chain: `ShieldedPositionPool.withdrawCollateral(...)` consumes the
//! old position nullifier and calls
//! `PrivacyEntry.creditBalance(newBalanceCommitment)`.
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
//!   - lt_bps                    ([Field; MAX_ASSETS])
//!
//! Private inputs:
//!   - secret_key
//!   - old_position
//!   - new_position_salt
//!   - new_balance_salt
//!   - merkle_siblings, merkle_index_bits
//!   - accrued_debts             ([Field; MAX_ASSETS])  (witness hints)
//!   - accrual_remainders        ([Field; MAX_ASSETS])  (witness hints)

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
    lt_bps: pub [Field; MAX_ASSETS],
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

    let pk = spending_pubkey_of(secret_key);
    assert(old_position.spending_pubkey == pk);

    // asset_id within range.
    let asset_id_u32 = asset_id as u32;
    assert(asset_id_u32 < MAX_ASSETS);

    // 1. Position ownership + Merkle inclusion.
    let old_pos_commit = position_commitment(old_position);
    let computed_root = merkle_root(old_pos_commit, merkle_siblings, merkle_index_bits);
    assert(computed_root == root_position);

    // 2. Nullifier binds (secret_key, old_position.salt).
    assert(old_position_nullifier_pub == position_nullifier(secret_key, old_position.salt));

    // 3. Apply accrual via witness hints (and bound LT_bps/prices/indices).
    //    assert_position_healthy runs check_accrual per slot internally.
    let mut accrued = apply_accrual(old_position, accrued_debts, current_borrow_indices);

    // 4. Reduce the chosen collateral slot by `amount`. Iterate to pick
    //    the matching index without dynamic indexing on Field.
    assert_bits::<AMOUNT_BITS>(amount);
    let mut new_collats = accrued.collaterals;
    let mut applied: bool = false;
    for i in 0..MAX_ASSETS {
        let i_field: Field = i as Field;
        if i_field == asset_id {
            // Conservation: amount <= collat[i].
            let old_collat = accrued.collaterals[i];
            assert_bits::<AMOUNT_BITS>(old_collat);
            // amount <= old_collat in field via lt:
            let new_collat = old_collat - amount;
            assert_bits::<AMOUNT_BITS>(new_collat);
            new_collats[i] = new_collat;
            applied = true;
        }
    }
    assert(applied);
    accrued.collaterals = new_collats;

    // 5. Post-op HF check vs LT bps.
    assert_position_healthy(
        accrued,
        current_prices,
        current_borrow_indices,
        lt_bps,
        accrued_debts,
        accrual_remainders,
    );

    // 6. Fresh salt on the new position commitment.
    accrued.salt = new_position_salt;
    assert(new_position_commitment == position_commitment(accrued));

    // 7. New balance note credits the withdrawn amount.
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

/// Build a tiny harness position with `collat_a` collateral in slot 0 and
/// `debt_b` debt in slot 1 (already accrued: idx_at_update == idx_now so
/// the accrual hint is the identity).
fn make_simple_position(
    secret_key: Field,
    collat_a: Field,
    debt_b: Field,
    idx_b_at_update: Field,
    salt: Field,
) -> Position {
    let pk = spending_pubkey_of(secret_key);
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[0] = collat_a;
    let mut debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    debts[1] = debt_b;
    let mut idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    if debt_b != 0 {
        idxs[1] = idx_b_at_update;
    }
    Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts,
        borrow_indices_at_update: idxs,
        salt,
    }
}

#[test]
fn test_happy_path_partial_withdraw_stays_healthy() {
    let secret_key: Field = 0xdead;
    // collateral 100k of asset 0 at $1, debt 50k of asset 1 at $1, LT[0]=80% (8000).
    // After withdrawing 10k: collat = 90k, weighted_collat = 90k*1*8000 = 720m.
    // Debt = 50k*1*10000 = 500m. 720m >= 500m -> healthy.
    let old_position = make_simple_position(secret_key, 100_000, 50_000, 1_000_000_000, 0xa);

    // Merkle path: empty siblings + bits.
    let old_commit = position_commitment(old_position);
    let sibs = empty_siblings();
    let bits = empty_bits();
    let root = merkle_root(old_commit, sibs, bits);
    let null = position_nullifier(secret_key, old_position.salt);

    let mut prices: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    prices[0] = 100_000_000;  // $1 (1e8)
    prices[1] = 100_000_000;
    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs_now[1] = 1_000_000_000;  // no interest growth
    let mut lt_bps: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    lt_bps[0] = 8_000;  // 80%
    lt_bps[1] = 8_000;

    // Accrual hints: debt unchanged (idx_now == idx_at_update).
    let mut accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    accrued[1] = 50_000;
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    // After withdraw: collat[0] = 90k.
    let mut new_cols: [Field; MAX_ASSETS] = old_position.collaterals;
    new_cols[0] = 90_000;
    let new_pos_salt: Field = 0xb;
    let new_position = Position {
        spending_pubkey: old_position.spending_pubkey,
        collaterals: new_cols,
        debts: accrued,
        borrow_indices_at_update: idxs_now,
        salt: new_pos_salt,
    };
    let new_pos_commit = position_commitment(new_position);

    // New balance note for 10k.
    let new_balance_salt: Field = 0xc;
    let pk = spending_pubkey_of(secret_key);
    let new_balance = BalanceNote {
        asset_id: 0,
        amount: 10_000,
        spending_pubkey: pk,
        salt: new_balance_salt,
    };
    let new_balance_commit = balance_commitment(new_balance);

    main(
        0, root, null, new_pos_commit, new_balance_commit,
        10_000, prices, idxs_now, lt_bps,
        secret_key, old_position, new_pos_salt, new_balance_salt,
        sibs, bits, accrued, remainders,
    );
}

#[test(should_fail)]
fn test_withdraw_breaks_health_rejected() {
    let secret_key: Field = 0xdead;
    // 50k collat, 40k debt at LT 80%: weighted_collat = 50k*1*8000 = 400m,
    // weighted_debt = 40k*1*10000 = 400m. HF = 1.0 exactly.
    // Try to withdraw 1k -> new collat 49k -> weighted_collat = 392m
    // < 400m. Reject.
    let old_position = make_simple_position(secret_key, 50_000, 40_000, 1_000_000_000, 0xa);
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
    let mut lt_bps: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    lt_bps[0] = 8_000;
    lt_bps[1] = 8_000;

    let mut accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    accrued[1] = 40_000;
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    let mut new_cols: [Field; MAX_ASSETS] = old_position.collaterals;
    new_cols[0] = 49_000;
    let new_pos_salt: Field = 0xb;
    let new_position = Position {
        spending_pubkey: old_position.spending_pubkey,
        collaterals: new_cols,
        debts: accrued,
        borrow_indices_at_update: idxs_now,
        salt: new_pos_salt,
    };
    let new_pos_commit = position_commitment(new_position);

    let new_balance_salt: Field = 0xc;
    let pk = spending_pubkey_of(secret_key);
    let new_balance =
        BalanceNote { asset_id: 0, amount: 1_000, spending_pubkey: pk, salt: new_balance_salt };
    let new_balance_commit = balance_commitment(new_balance);

    main(
        0, root, null, new_pos_commit, new_balance_commit,
        1_000, prices, idxs_now, lt_bps,
        secret_key, old_position, new_pos_salt, new_balance_salt,
        sibs, bits, accrued, remainders,
    );
}

#[test(should_fail)]
fn test_wrong_balance_amount_rejected() {
    let secret_key: Field = 0xdead;
    let old_position = make_simple_position(secret_key, 100_000, 0, 0, 0xa);
    let old_commit = position_commitment(old_position);
    let sibs = empty_siblings();
    let bits = empty_bits();
    let root = merkle_root(old_commit, sibs, bits);
    let null = position_nullifier(secret_key, old_position.salt);

    let mut prices: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    prices[0] = 100_000_000;
    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let mut lt_bps: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    lt_bps[0] = 8_000;

    let accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    let mut new_cols: [Field; MAX_ASSETS] = old_position.collaterals;
    new_cols[0] = 90_000;  // withdrew 10k
    let new_pos_salt: Field = 0xb;
    let new_position = Position {
        spending_pubkey: old_position.spending_pubkey,
        collaterals: new_cols,
        debts: accrued,
        borrow_indices_at_update: idxs_now,
        salt: new_pos_salt,
    };
    let new_pos_commit = position_commitment(new_position);

    let new_balance_salt: Field = 0xc;
    let pk = spending_pubkey_of(secret_key);
    // Wrong: balance note claims 15k credited though position only released 10k.
    let new_balance =
        BalanceNote { asset_id: 0, amount: 15_000, spending_pubkey: pk, salt: new_balance_salt };
    let new_balance_commit = balance_commitment(new_balance);

    main(
        0, root, null, new_pos_commit, new_balance_commit,
        10_000, prices, idxs_now, lt_bps,
        secret_key, old_position, new_pos_salt, new_balance_salt,
        sibs, bits, accrued, remainders,
    );
}

#[test(should_fail)]
fn test_zero_amount_rejected() {
    let secret_key: Field = 0xdead;
    let old_position = make_simple_position(secret_key, 100_000, 0, 0, 0xa);
    let old_commit = position_commitment(old_position);
    let sibs = empty_siblings();
    let bits = empty_bits();
    let root = merkle_root(old_commit, sibs, bits);
    let null = position_nullifier(secret_key, old_position.salt);

    let mut prices: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    prices[0] = 100_000_000;
    let idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let mut lt_bps: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    lt_bps[0] = 8_000;
    let accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    let new_pos_salt: Field = 0xb;
    let new_position = Position {
        spending_pubkey: old_position.spending_pubkey,
        collaterals: old_position.collaterals,
        debts: accrued,
        borrow_indices_at_update: idxs_now,
        salt: new_pos_salt,
    };
    let new_pos_commit = position_commitment(new_position);

    let new_balance_salt: Field = 0xc;
    let pk = spending_pubkey_of(secret_key);
    let new_balance =
        BalanceNote { asset_id: 0, amount: 0, spending_pubkey: pk, salt: new_balance_salt };
    let new_balance_commit = balance_commitment(new_balance);

    main(
        0, root, null, new_pos_commit, new_balance_commit,
        0, prices, idxs_now, lt_bps,
        secret_key, old_position, new_pos_salt, new_balance_salt,
        sibs, bits, accrued, remainders,
    );
}
