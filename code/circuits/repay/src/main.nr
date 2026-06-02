//! repay circuit -- S02 sec.2 circuit 09 / S12 circuit 08.
//!
//! Proves: caller spends a balance note in `asset_id` from PrivacyEntry's
//! tree and reduces `debts[asset_id]` on a Position. Any unspent
//! remainder of the balance note becomes a residual balance commitment.
//! Repaying strictly improves health, so no post-op HF check is required
//! (we still accrue the debt slots so the new position commitment binds
//! up-to-date indices).
//!
//! Public inputs:
//!   - asset_id
//!   - root_balance
//!   - root_position
//!   - balance_nullifier
//!   - position_nullifier_pub
//!   - residual_balance_commitment
//!   - new_position_commitment
//!   - amount                     (units repaid; must be <= accrued debt)
//!   - current_borrow_indices     ([Field; MAX_ASSETS])
//!
//! Private inputs:
//!   - secret_key
//!   - old_balance_amount, old_balance_salt, new_balance_salt
//!   - old_position, new_position_salt
//!   - balance_siblings, balance_index_bits
//!   - position_siblings, position_index_bits
//!   - accrued_debts, accrual_remainders  (witness hints)

use lib_common::{
    apply_accrual, assert_bits, balance_commitment, balance_nullifier, BalanceNote,
    check_accrual, merkle_root, Position, position_commitment, position_nullifier,
    spending_pubkey_of, AMOUNT_BITS, MAX_ASSETS, TREE_DEPTH,
};

fn main(
    asset_id: pub Field,
    root_balance: pub Field,
    root_position: pub Field,
    balance_nullifier_pub: pub Field,
    position_nullifier_pub: pub Field,
    residual_balance_commitment: pub Field,
    new_position_commitment: pub Field,
    amount: pub Field,
    current_borrow_indices: pub [Field; MAX_ASSETS],
    secret_key: Field,
    old_balance_amount: Field,
    old_balance_salt: Field,
    new_balance_salt: Field,
    old_position: Position,
    new_position_salt: Field,
    balance_siblings: [Field; TREE_DEPTH],
    balance_index_bits: [bool; TREE_DEPTH],
    position_siblings: [Field; TREE_DEPTH],
    position_index_bits: [bool; TREE_DEPTH],
    accrued_debts: [Field; MAX_ASSETS],
    accrual_remainders: [Field; MAX_ASSETS],
) {
    assert(secret_key != 0);
    assert(old_balance_salt != 0);
    assert(new_balance_salt != 0);
    assert(new_position_salt != 0);
    assert(amount != 0);
    assert_bits::<AMOUNT_BITS>(amount);
    assert_bits::<AMOUNT_BITS>(old_balance_amount);

    let pk = spending_pubkey_of(secret_key);

    // asset_id in range.
    let asset_id_u32 = asset_id as u32;
    assert(asset_id_u32 < MAX_ASSETS);

    // 1. Balance note ownership + Merkle inclusion.
    let old_balance = BalanceNote {
        asset_id,
        amount: old_balance_amount,
        spending_pubkey: pk,
        salt: old_balance_salt,
    };
    let old_balance_commit = balance_commitment(old_balance);
    let computed_root_b =
        merkle_root(old_balance_commit, balance_siblings, balance_index_bits);
    assert(computed_root_b == root_balance);
    assert(balance_nullifier_pub == balance_nullifier(secret_key, old_balance_salt));

    // 2. Position ownership + Merkle inclusion.
    assert(old_position.spending_pubkey == pk);
    let old_pos_commit = position_commitment(old_position);
    let computed_root_p =
        merkle_root(old_pos_commit, position_siblings, position_index_bits);
    assert(computed_root_p == root_position);
    assert(position_nullifier_pub == position_nullifier(secret_key, old_position.salt));

    // 3. Conservation: amount <= old_balance_amount.
    let old_b_u128 = old_balance_amount as u128;
    let amount_u128 = amount as u128;
    assert(amount_u128 <= old_b_u128);
    let residual_amount = old_balance_amount - amount;
    let residual = BalanceNote {
        asset_id,
        amount: residual_amount,
        spending_pubkey: pk,
        salt: new_balance_salt,
    };
    assert(residual_balance_commitment == balance_commitment(residual));

    // 4. Run accrual hints for every slot.
    for i in 0..MAX_ASSETS {
        check_accrual(
            old_position.debts[i],
            current_borrow_indices[i],
            old_position.borrow_indices_at_update[i],
            accrued_debts[i],
            accrual_remainders[i],
        );
    }

    // 5. Apply repay to the chosen slot. amount <= accrued_debt[id].
    let mut accrued = apply_accrual(old_position, accrued_debts, current_borrow_indices);
    let mut new_debts = accrued.debts;
    let mut applied: bool = false;
    for i in 0..MAX_ASSETS {
        let i_field: Field = i as Field;
        if i_field == asset_id {
            let acc = accrued.debts[i];
            assert_bits::<AMOUNT_BITS>(acc);
            // amount <= acc
            assert(!acc.lt(amount));
            new_debts[i] = acc - amount;
        }
    }
    // Find-and-apply must hit exactly once.
    for i in 0..MAX_ASSETS {
        let i_field: Field = i as Field;
        if i_field == asset_id {
            applied = true;
        }
    }
    assert(applied);
    accrued.debts = new_debts;

    // 6. New position commitment with refreshed salt.
    accrued.salt = new_position_salt;
    assert(new_position_commitment == position_commitment(accrued));
}

// --- Tests ---------------------------------------------------------------

fn empty_siblings() -> [Field; TREE_DEPTH] { [0; TREE_DEPTH] }
fn empty_bits() -> [bool; TREE_DEPTH] { [false; TREE_DEPTH] }

#[test]
fn test_full_repay_clears_debt_slot() {
    let secret_key: Field = 0xdead;
    let pk = spending_pubkey_of(secret_key);

    // Position: 100k collat in slot 0, 30k debt in slot 1 at base idx.
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[0] = 100_000;
    let mut debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    debts[1] = 30_000;
    let mut idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs[1] = 1_000_000_000;
    let old_position = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts,
        borrow_indices_at_update: idxs,
        salt: 0xa1,
    };

    // Balance note in asset 1 worth 50k (covers repay + leaves residual).
    let old_balance_amount: Field = 50_000;
    let old_balance_salt: Field = 0xb1;
    let old_balance = BalanceNote {
        asset_id: 1,
        amount: old_balance_amount,
        spending_pubkey: pk,
        salt: old_balance_salt,
    };
    let bal_commit = balance_commitment(old_balance);
    let bal_sibs = empty_siblings();
    let bal_bits = empty_bits();
    let root_balance = merkle_root(bal_commit, bal_sibs, bal_bits);
    let bal_null = balance_nullifier(secret_key, old_balance_salt);

    let pos_commit = position_commitment(old_position);
    let pos_sibs = empty_siblings();
    let pos_bits = empty_bits();
    let root_position = merkle_root(pos_commit, pos_sibs, pos_bits);
    let pos_null = position_nullifier(secret_key, old_position.salt);

    // No interest accrued (idx_now == idx_at_update). accrued[1] = 30_000.
    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs_now[1] = 1_000_000_000;
    let mut accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    accrued[1] = 30_000;
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    let new_balance_salt: Field = 0xb2;
    let residual = BalanceNote {
        asset_id: 1,
        amount: 50_000 - 30_000,
        spending_pubkey: pk,
        salt: new_balance_salt,
    };
    let residual_commit = balance_commitment(residual);

    // New position: debt[1] = 0, indices refreshed.
    let new_pos_salt: Field = 0xa2;
    let mut new_debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let new_position = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts: new_debts,
        borrow_indices_at_update: idxs_now,
        salt: new_pos_salt,
    };
    let new_pos_commit = position_commitment(new_position);

    main(
        1, root_balance, root_position, bal_null, pos_null,
        residual_commit, new_pos_commit, 30_000, idxs_now,
        secret_key, old_balance_amount, old_balance_salt, new_balance_salt,
        old_position, new_pos_salt,
        bal_sibs, bal_bits, pos_sibs, pos_bits,
        accrued, remainders,
    );
}

#[test(should_fail)]
fn test_overrepay_rejected() {
    let secret_key: Field = 0xdead;
    let pk = spending_pubkey_of(secret_key);
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[0] = 100_000;
    let mut debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    debts[1] = 30_000;
    let mut idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs[1] = 1_000_000_000;
    let old_position = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts,
        borrow_indices_at_update: idxs,
        salt: 0xa1,
    };
    let old_balance_amount: Field = 50_000;
    let old_balance_salt: Field = 0xb1;
    let old_balance = BalanceNote {
        asset_id: 1, amount: old_balance_amount, spending_pubkey: pk, salt: old_balance_salt,
    };
    let bal_commit = balance_commitment(old_balance);
    let sibs = empty_siblings();
    let bits = empty_bits();
    let root_balance = merkle_root(bal_commit, sibs, bits);
    let bal_null = balance_nullifier(secret_key, old_balance_salt);

    let pos_commit = position_commitment(old_position);
    let root_position = merkle_root(pos_commit, sibs, bits);
    let pos_null = position_nullifier(secret_key, old_position.salt);

    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs_now[1] = 1_000_000_000;
    let mut accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    accrued[1] = 30_000;
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    let new_balance_salt: Field = 0xb2;
    // overpay: amount = 40k > accrued debt 30k
    let bad_amount: Field = 40_000;
    let residual = BalanceNote {
        asset_id: 1,
        amount: 50_000 - 40_000,
        spending_pubkey: pk,
        salt: new_balance_salt,
    };
    let residual_commit = balance_commitment(residual);

    let new_pos_salt: Field = 0xa2;
    let mut new_debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let new_position = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts: new_debts,
        borrow_indices_at_update: idxs_now,
        salt: new_pos_salt,
    };
    let new_pos_commit = position_commitment(new_position);

    main(
        1, root_balance, root_position, bal_null, pos_null,
        residual_commit, new_pos_commit, bad_amount, idxs_now,
        secret_key, old_balance_amount, old_balance_salt, new_balance_salt,
        old_position, new_pos_salt,
        sibs, bits, sibs, bits,
        accrued, remainders,
    );
}

#[test(should_fail)]
fn test_balance_overdrawn_rejected() {
    // Balance note 30k, claim repay 40k.
    let secret_key: Field = 0xdead;
    let pk = spending_pubkey_of(secret_key);
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[0] = 100_000;
    let mut debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    debts[1] = 60_000;
    let mut idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs[1] = 1_000_000_000;
    let old_position = Position {
        spending_pubkey: pk, collaterals: cols, debts,
        borrow_indices_at_update: idxs, salt: 0xa1,
    };
    let old_balance_amount: Field = 30_000;
    let old_balance_salt: Field = 0xb1;
    let old_balance = BalanceNote {
        asset_id: 1, amount: old_balance_amount, spending_pubkey: pk, salt: old_balance_salt,
    };
    let bal_commit = balance_commitment(old_balance);
    let sibs = empty_siblings();
    let bits = empty_bits();
    let root_balance = merkle_root(bal_commit, sibs, bits);
    let bal_null = balance_nullifier(secret_key, old_balance_salt);
    let pos_commit = position_commitment(old_position);
    let root_position = merkle_root(pos_commit, sibs, bits);
    let pos_null = position_nullifier(secret_key, old_position.salt);

    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs_now[1] = 1_000_000_000;
    let mut accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    accrued[1] = 60_000;
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    let new_balance_salt: Field = 0xb2;
    let bad_amount: Field = 40_000;  // > 30k available
    // residual = -10k in the field (wraps); circuit's u128 conservation rejects.
    let residual = BalanceNote {
        asset_id: 1,
        amount: 30_000 - 40_000,  // negative -> field wrap
        spending_pubkey: pk,
        salt: new_balance_salt,
    };
    let residual_commit = balance_commitment(residual);

    let new_pos_salt: Field = 0xa2;
    let mut new_debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    new_debts[1] = 20_000;
    let new_position = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts: new_debts,
        borrow_indices_at_update: idxs_now,
        salt: new_pos_salt,
    };
    let new_pos_commit = position_commitment(new_position);

    main(
        1, root_balance, root_position, bal_null, pos_null,
        residual_commit, new_pos_commit, bad_amount, idxs_now,
        secret_key, old_balance_amount, old_balance_salt, new_balance_salt,
        old_position, new_pos_salt,
        sibs, bits, sibs, bits,
        accrued, remainders,
    );
}
