//! deposit_collateral circuit -- S02 sec.2 circuit 06.
//!
//! Proves: caller spends a balance note (asset_id) in PrivacyEntry's tree
//! and either (a) creates a fresh single-asset Position with that amount
//! placed in the right collateral slot, or (b) increases the
//! collateral[asset_id] slot of an existing Position. Any unused remainder
//! of the balance note becomes a residual balance commitment.
//!
//! We do NOT verify the position health here -- depositing more collateral
//! cannot make a healthy position unhealthy. (Health is enforced in
//! borrow / withdraw_collateral, where it can decrease.)
//!
//! Public inputs:
//!   - asset_id
//!   - root_balance       (PrivacyEntry root)
//!   - root_position      (BorrowPool root; ignored when create_new == 1)
//!   - balance_nullifier_pub
//!   - position_nullifier_pub  (zero when create_new == 1)
//!   - residual_balance_commitment
//!   - new_position_commitment
//!   - amount             (how much of the balance note moves into collateral)
//!   - create_new         (1 = open new position; 0 = augment existing)
//!
//! Private inputs:
//!   - secret_key
//!   - old_balance_amount, old_balance_salt, new_balance_salt
//!   - old_position (only meaningful when create_new == 0)
//!   - new_position_salt
//!   - balance_siblings, balance_index_bits
//!   - position_siblings, position_index_bits

use lib_common::{
    balance_commitment, balance_nullifier, BalanceNote, MAX_ASSETS, merkle_root,
    Position, position_commitment, position_nullifier, spending_pubkey_of,
    TREE_DEPTH,
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
    create_new: pub Field,
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
) {
    assert(secret_key != 0);
    assert(old_balance_salt != 0);
    assert(new_balance_salt != 0);
    assert(new_position_salt != 0);
    assert(amount != 0);
    assert((create_new == 0) | (create_new == 1));

    let pk = spending_pubkey_of(secret_key);

    // 1. Bound asset_id < MAX_ASSETS so the chosen slot is in range.
    let asset_id_u32 = asset_id as u32;
    assert(asset_id_u32 < MAX_ASSETS);

    // 2. Spend the balance note: ownership + Merkle inclusion + nullifier.
    let old_balance = BalanceNote {
        asset_id, amount: old_balance_amount,
        spending_pubkey: pk, salt: old_balance_salt,
    };
    let old_balance_commit = balance_commitment(old_balance);
    let computed_root_b = merkle_root(old_balance_commit, balance_siblings, balance_index_bits);
    assert(computed_root_b == root_balance);
    assert(balance_nullifier_pub == balance_nullifier(secret_key, old_balance_salt));

    // 3. Conservation on balance note.
    let old_b_u128 = old_balance_amount as u128;
    let amt_u128 = amount as u128;
    assert(amt_u128 <= old_b_u128);
    let residual_amount = old_balance_amount - amount;
    let residual = BalanceNote {
        asset_id, amount: residual_amount,
        spending_pubkey: pk, salt: new_balance_salt,
    };
    assert(residual_balance_commitment == balance_commitment(residual));

    // 4. Compute the new position by branching on create_new.
    let mut new_position = if create_new == 1 {
        // Fresh position: empty arrays, then deposit into the chosen slot.
        Position {
            spending_pubkey: pk,
            collaterals: [0; MAX_ASSETS],
            debts: [0; MAX_ASSETS],
            borrow_indices_at_update: [0; MAX_ASSETS],
            salt: new_position_salt,
        }
    } else {
        // Augment existing: prove ownership of old_position via nullifier
        // and Merkle inclusion, then start from its slots.
        assert(old_position.spending_pubkey == pk);
        let old_pos_commit = position_commitment(old_position);
        let computed_root_p = merkle_root(old_pos_commit, position_siblings, position_index_bits);
        assert(computed_root_p == root_position);
        assert(position_nullifier_pub == position_nullifier(secret_key, old_position.salt));

        Position {
            spending_pubkey: pk,
            collaterals: old_position.collaterals,
            debts: old_position.debts,
            borrow_indices_at_update: old_position.borrow_indices_at_update,
            salt: new_position_salt,
        }
    };

    // When create_new == 1, position_nullifier_pub must be zero
    // (no old position to consume).
    if create_new == 1 {
        assert(position_nullifier_pub == 0);
    }

    // 5. Add `amount` into the asset_id slot. Pick the one matching index
    //    by iterating (Noir doesn't support array[Field]).
    let mut updated_collaterals: [Field; MAX_ASSETS] = new_position.collaterals;
    for i in 0..MAX_ASSETS {
        let i_field: Field = i as Field;
        let is_target = (i_field == asset_id);
        if is_target {
            updated_collaterals[i] = new_position.collaterals[i] + amount;
        }
    }
    new_position.collaterals = updated_collaterals;

    // 6. New commitment binds the new position.
    assert(new_position_commitment == position_commitment(new_position));
}

// --- Tests ---------------------------------------------------------------

fn empty_siblings() -> [Field; TREE_DEPTH] { [0; TREE_DEPTH] }
fn empty_index_bits() -> [bool; TREE_DEPTH] { [false; TREE_DEPTH] }

#[test]
fn test_create_new_position() {
    let asset_id: Field = 1;
    let secret_key: Field = 0xdead;
    let old_balance_amount: Field = 1_000_000;
    let old_balance_salt: Field = 0xa;
    let new_balance_salt: Field = 0xb;
    let new_position_salt: Field = 0xc;
    let amount: Field = 500_000;

    let pk = spending_pubkey_of(secret_key);
    let old_balance = BalanceNote {
        asset_id, amount: old_balance_amount,
        spending_pubkey: pk, salt: old_balance_salt,
    };
    let old_b_commit = balance_commitment(old_balance);
    let bal_sibs = empty_siblings();
    let bal_bits = empty_index_bits();
    let root_balance = merkle_root(old_b_commit, bal_sibs, bal_bits);
    let bal_null = balance_nullifier(secret_key, old_balance_salt);
    let residual = BalanceNote {
        asset_id, amount: old_balance_amount - amount,
        spending_pubkey: pk, salt: new_balance_salt,
    };
    let residual_commit = balance_commitment(residual);

    // Build the new position the circuit will produce: zero everywhere
    // except slot `asset_id`.
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[1] = amount;
    let new_pos = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts: [0; MAX_ASSETS],
        borrow_indices_at_update: [0; MAX_ASSETS],
        salt: new_position_salt,
    };
    let new_pos_commit = position_commitment(new_pos);

    // Dummy old_position (unused when create_new == 1).
    let dummy_pos = Position {
        spending_pubkey: 0,
        collaterals: [0; MAX_ASSETS],
        debts: [0; MAX_ASSETS],
        borrow_indices_at_update: [0; MAX_ASSETS],
        salt: 0,
    };

    main(
        asset_id, root_balance, 0, bal_null, 0,
        residual_commit, new_pos_commit, amount, 1,
        secret_key, old_balance_amount, old_balance_salt,
        new_balance_salt, dummy_pos, new_position_salt,
        bal_sibs, bal_bits, empty_siblings(), empty_index_bits(),
    );
}

#[test]
fn test_augment_existing_position() {
    let asset_id: Field = 0;
    let secret_key: Field = 0xfeed;
    let pk = spending_pubkey_of(secret_key);
    let old_balance_amount: Field = 800_000;
    let old_balance_salt: Field = 0x10;
    let new_balance_salt: Field = 0x11;
    let new_position_salt: Field = 0x12;
    let amount: Field = 800_000;

    // Old position: 100k of asset 0, plus 50k debt of asset 1.
    let mut old_cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    old_cols[0] = 100_000;
    let mut old_debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    old_debts[1] = 50_000;
    let mut old_idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    old_idxs[1] = 1_000_000_000;
    let old_position = Position {
        spending_pubkey: pk,
        collaterals: old_cols,
        debts: old_debts,
        borrow_indices_at_update: old_idxs,
        salt: 0xfff,
    };

    // Roots:
    let old_balance = BalanceNote {
        asset_id, amount: old_balance_amount,
        spending_pubkey: pk, salt: old_balance_salt,
    };
    let old_b_commit = balance_commitment(old_balance);
    let bal_sibs = empty_siblings();
    let bal_bits = empty_index_bits();
    let root_balance = merkle_root(old_b_commit, bal_sibs, bal_bits);
    let bal_null = balance_nullifier(secret_key, old_balance_salt);

    let old_pos_commit = position_commitment(old_position);
    let pos_sibs = empty_siblings();
    let pos_bits = empty_index_bits();
    let root_position = merkle_root(old_pos_commit, pos_sibs, pos_bits);
    let pos_null = position_nullifier(secret_key, old_position.salt);

    // Residual balance is 0.
    let residual = BalanceNote {
        asset_id, amount: 0,
        spending_pubkey: pk, salt: new_balance_salt,
    };
    let residual_commit = balance_commitment(residual);

    // New position: collat[0] = 100k + 800k = 900k; everything else preserved.
    let mut new_cols = old_cols;
    new_cols[0] = old_cols[0] + amount;
    let new_pos = Position {
        spending_pubkey: pk,
        collaterals: new_cols,
        debts: old_debts,
        borrow_indices_at_update: old_idxs,
        salt: new_position_salt,
    };
    let new_pos_commit = position_commitment(new_pos);

    main(
        asset_id, root_balance, root_position, bal_null, pos_null,
        residual_commit, new_pos_commit, amount, 0,
        secret_key, old_balance_amount, old_balance_salt,
        new_balance_salt, old_position, new_position_salt,
        bal_sibs, bal_bits, pos_sibs, pos_bits,
    );
}

#[test(should_fail)]
fn test_create_new_with_nonzero_position_nullifier_rejected() {
    let asset_id: Field = 1;
    let secret_key: Field = 0xdead;
    let old_balance_amount: Field = 1_000_000;
    let old_balance_salt: Field = 0xa;
    let new_balance_salt: Field = 0xb;
    let new_position_salt: Field = 0xc;
    let amount: Field = 500_000;

    let pk = spending_pubkey_of(secret_key);
    let old_balance = BalanceNote {
        asset_id, amount: old_balance_amount,
        spending_pubkey: pk, salt: old_balance_salt,
    };
    let old_b_commit = balance_commitment(old_balance);
    let bal_sibs = empty_siblings();
    let bal_bits = empty_index_bits();
    let root_balance = merkle_root(old_b_commit, bal_sibs, bal_bits);
    let bal_null = balance_nullifier(secret_key, old_balance_salt);
    let residual = BalanceNote {
        asset_id, amount: old_balance_amount - amount,
        spending_pubkey: pk, salt: new_balance_salt,
    };
    let residual_commit = balance_commitment(residual);

    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[1] = amount;
    let new_pos = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts: [0; MAX_ASSETS],
        borrow_indices_at_update: [0; MAX_ASSETS],
        salt: new_position_salt,
    };
    let new_pos_commit = position_commitment(new_pos);

    let dummy_pos = Position {
        spending_pubkey: 0,
        collaterals: [0; MAX_ASSETS],
        debts: [0; MAX_ASSETS],
        borrow_indices_at_update: [0; MAX_ASSETS],
        salt: 0,
    };

    main(
        asset_id, root_balance, 0, bal_null,
        0xbadbad, // nonzero position_nullifier on a "create_new" path: must fail
        residual_commit, new_pos_commit, amount, 1,
        secret_key, old_balance_amount, old_balance_salt,
        new_balance_salt, dummy_pos, new_position_salt,
        bal_sibs, bal_bits, empty_siblings(), empty_index_bits(),
    );
}

#[test(should_fail)]
fn test_wrong_slot_credited_rejected() {
    // Witness deposits 500k of asset 1, but the new_position commitment
    // claims the credit went into slot 2.
    let asset_id: Field = 1;
    let secret_key: Field = 0xdead;
    let old_balance_amount: Field = 1_000_000;
    let old_balance_salt: Field = 0xa;
    let new_balance_salt: Field = 0xb;
    let new_position_salt: Field = 0xc;
    let amount: Field = 500_000;

    let pk = spending_pubkey_of(secret_key);
    let old_balance = BalanceNote {
        asset_id, amount: old_balance_amount,
        spending_pubkey: pk, salt: old_balance_salt,
    };
    let old_b_commit = balance_commitment(old_balance);
    let bal_sibs = empty_siblings();
    let bal_bits = empty_index_bits();
    let root_balance = merkle_root(old_b_commit, bal_sibs, bal_bits);
    let bal_null = balance_nullifier(secret_key, old_balance_salt);
    let residual = BalanceNote {
        asset_id, amount: old_balance_amount - amount,
        spending_pubkey: pk, salt: new_balance_salt,
    };
    let residual_commit = balance_commitment(residual);

    // WRONG: claim slot 2 holds the deposit.
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[2] = amount;
    let bogus_pos = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts: [0; MAX_ASSETS],
        borrow_indices_at_update: [0; MAX_ASSETS],
        salt: new_position_salt,
    };
    let bogus_commit = position_commitment(bogus_pos);

    let dummy_pos = Position {
        spending_pubkey: 0,
        collaterals: [0; MAX_ASSETS],
        debts: [0; MAX_ASSETS],
        borrow_indices_at_update: [0; MAX_ASSETS],
        salt: 0,
    };

    main(
        asset_id, root_balance, 0, bal_null, 0,
        residual_commit, bogus_commit, amount, 1,
        secret_key, old_balance_amount, old_balance_salt,
        new_balance_salt, dummy_pos, new_position_salt,
        bal_sibs, bal_bits, empty_siblings(), empty_index_bits(),
    );
}

#[test(should_fail)]
fn test_asset_id_out_of_range_rejected() {
    let asset_id: Field = 99; // > MAX_ASSETS
    let secret_key: Field = 0xdead;
    let old_balance_amount: Field = 1_000_000;
    let old_balance_salt: Field = 0xa;
    let new_balance_salt: Field = 0xb;
    let new_position_salt: Field = 0xc;
    let amount: Field = 500_000;

    let pk = spending_pubkey_of(secret_key);
    let old_balance = BalanceNote {
        asset_id, amount: old_balance_amount,
        spending_pubkey: pk, salt: old_balance_salt,
    };
    let old_b_commit = balance_commitment(old_balance);
    let bal_sibs = empty_siblings();
    let bal_bits = empty_index_bits();
    let root_balance = merkle_root(old_b_commit, bal_sibs, bal_bits);
    let bal_null = balance_nullifier(secret_key, old_balance_salt);
    let residual = BalanceNote {
        asset_id, amount: old_balance_amount - amount,
        spending_pubkey: pk, salt: new_balance_salt,
    };
    let residual_commit = balance_commitment(residual);

    let cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    let new_pos = Position {
        spending_pubkey: pk,
        collaterals: cols,
        debts: [0; MAX_ASSETS],
        borrow_indices_at_update: [0; MAX_ASSETS],
        salt: new_position_salt,
    };
    let new_pos_commit = position_commitment(new_pos);

    let dummy_pos = Position {
        spending_pubkey: 0,
        collaterals: [0; MAX_ASSETS],
        debts: [0; MAX_ASSETS],
        borrow_indices_at_update: [0; MAX_ASSETS],
        salt: 0,
    };

    main(
        asset_id, root_balance, 0, bal_null, 0,
        residual_commit, new_pos_commit, amount, 1,
        secret_key, old_balance_amount, old_balance_salt,
        new_balance_salt, dummy_pos, new_position_salt,
        bal_sibs, bal_bits, empty_siblings(), empty_index_bits(),
    );
}
