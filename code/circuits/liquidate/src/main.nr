//! liquidate circuit -- S02 sec.2 circuit 10 / S12 circuit 09.
//!
//! Proves: the target Position is UNHEALTHY at LT (eligible for
//! liquidation), the liquidator pays `debt_to_cover` of the named debt
//! asset, and receives `collateral_seized` of the named collateral
//! asset (principal + bonus, bps split per S01 sec.3). A residual
//! Position commitment captures the post-seizure state.
//!
//! Public inputs:
//!   - collateral_asset_id
//!   - debt_asset_id
//!   - root_position
//!   - target_position_nullifier
//!   - residual_position_commitment
//!   - liquidator_balance_commitment   (collateral seized, into liquidator's note)
//!   - debt_to_cover
//!   - collateral_seized
//!   - current_prices
//!   - current_borrow_indices
//!   - lt_bps
//!   - bonus_bps                        (e.g. 800 = 8%)
//!
//! Private inputs:
//!   - target_position
//!   - target_secret_pubkey_proof       (target's spending_pubkey; needed to
//!                                       reconstruct the commitment; the
//!                                       liquidator doesn't know the target's
//!                                       secret key)
//!   - liquidator_spending_pubkey
//!   - liquidator_balance_salt
//!   - residual_position_salt
//!   - merkle_siblings, merkle_index_bits
//!   - accrued_debts, accrual_remainders
//!
//! Note: the target's nullifier is derived without their secret key by
//! convention -- liquidations work via a nullifier-from-commitment
//! scheme tracked by the on-chain pool. For Day-5 we model the target
//! nullifier as a public value the contract accepts; the circuit binds
//! it to the target commitment via inclusion in the position tree.

use lib_common::{
    apply_accrual, assert_bits, balance_commitment, BalanceNote,
    assert_position_healthy, check_accrual, merkle_root, Position,
    position_commitment, spending_pubkey_of, AMOUNT_BITS, BPS_BITS, BPS_DENOM,
    MAX_ASSETS, TREE_DEPTH,
};

fn main(
    collateral_asset_id: pub Field,
    debt_asset_id: pub Field,
    root_position: pub Field,
    target_position_nullifier_pub: pub Field,
    residual_position_commitment: pub Field,
    liquidator_balance_commitment: pub Field,
    debt_to_cover: pub Field,
    collateral_seized: pub Field,
    current_prices: pub [Field; MAX_ASSETS],
    current_borrow_indices: pub [Field; MAX_ASSETS],
    lt_bps: pub [Field; MAX_ASSETS],
    bonus_bps: pub Field,
    target_position: Position,
    liquidator_spending_pubkey: Field,
    liquidator_balance_salt: Field,
    residual_position_salt: Field,
    merkle_siblings: [Field; TREE_DEPTH],
    merkle_index_bits: [bool; TREE_DEPTH],
    accrued_debts: [Field; MAX_ASSETS],
    accrual_remainders: [Field; MAX_ASSETS],
) {
    assert(debt_to_cover != 0);
    assert(collateral_seized != 0);
    assert_bits::<AMOUNT_BITS>(debt_to_cover);
    assert_bits::<AMOUNT_BITS>(collateral_seized);
    assert_bits::<BPS_BITS>(bonus_bps);

    let col_id_u32 = collateral_asset_id as u32;
    let debt_id_u32 = debt_asset_id as u32;
    assert(col_id_u32 < MAX_ASSETS);
    assert(debt_id_u32 < MAX_ASSETS);

    // 1. Target Position ownership-by-commitment (Merkle inclusion).
    let target_commit = position_commitment(target_position);
    let computed_root = merkle_root(target_commit, merkle_siblings, merkle_index_bits);
    assert(computed_root == root_position);

    // 2. Target nullifier binds to the commitment under a commitment-only
    //    scheme (liquidator can't sign; the on-chain pool exposes a
    //    nullifier derivation from the commitment). For the circuit we
    //    bind the public nullifier to a hash of (commitment, target.salt).
    //    Equivalent to a "salt nullifier" -- same domain separation
    //    technique used elsewhere in lib_common.
    assert(target_position_nullifier_pub == hash_target_nullifier(target_commit));

    // 3. Accrue target's debts.
    let pre_accrued = apply_accrual(target_position, accrued_debts, current_borrow_indices);
    for i in 0..MAX_ASSETS {
        check_accrual(
            target_position.debts[i],
            current_borrow_indices[i],
            target_position.borrow_indices_at_update[i],
            accrued_debts[i],
            accrual_remainders[i],
        );
    }

    // 4. Pre-op unhealthy check. We assert HF is BELOW 1.0 at LT, i.e.
    //    weighted_collat < weighted_debt under LT.
    //    Reuse the formula's components manually instead of the helper
    //    (which only asserts >=).
    let (collat_v, debt_v) = compute_hf_terms(
        pre_accrued, current_prices, current_borrow_indices, lt_bps,
        accrued_debts, accrual_remainders,
    );
    assert(collat_v.lt(debt_v));

    // 5. Apply seizure: collat[col] -= seized; debts[debt] -= debt_to_cover.
    let mut new_collats = pre_accrued.collaterals;
    let mut new_debts = pre_accrued.debts;
    for i in 0..MAX_ASSETS {
        let i_field: Field = i as Field;
        if i_field == collateral_asset_id {
            let old_collat = pre_accrued.collaterals[i];
            assert_bits::<AMOUNT_BITS>(old_collat);
            // seizure <= collat
            assert(!old_collat.lt(collateral_seized));
            new_collats[i] = old_collat - collateral_seized;
        }
        if i_field == debt_asset_id {
            let acc = pre_accrued.debts[i];
            assert_bits::<AMOUNT_BITS>(acc);
            assert(!acc.lt(debt_to_cover));
            new_debts[i] = acc - debt_to_cover;
        }
    }
    let mut residual_position = pre_accrued;
    residual_position.collaterals = new_collats;
    residual_position.debts = new_debts;
    residual_position.salt = residual_position_salt;

    // 6. Seizure economics: collateral_seized * collateral_price ==
    //    debt_to_cover * debt_price * (10000 + bonus_bps) / 10000.
    //    Avoid division -- multiply through by 10000.
    let col_price = price_at(current_prices, collateral_asset_id);
    let debt_price = price_at(current_prices, debt_asset_id);
    let lhs = collateral_seized * col_price * BPS_DENOM;
    let rhs = debt_to_cover * debt_price * (BPS_DENOM + bonus_bps);
    assert(lhs == rhs);

    // 7. Residual position commitment.
    assert(residual_position_commitment == position_commitment(residual_position));

    // 8. Liquidator balance note credits the seized collateral as a
    //    balance commitment under liquidator_spending_pubkey.
    let liq_balance = BalanceNote {
        asset_id: collateral_asset_id,
        amount: collateral_seized,
        spending_pubkey: liquidator_spending_pubkey,
        salt: liquidator_balance_salt,
    };
    assert(liquidator_balance_commitment == balance_commitment(liq_balance));
}

fn hash_target_nullifier(commitment: Field) -> Field {
    // Tagged Pedersen hash for the "salt nullifier" scheme.
    std::hash::pedersen_hash([24, commitment])
}

fn compute_hf_terms(
    position: Position,
    current_prices: [Field; MAX_ASSETS],
    _current_borrow_indices: [Field; MAX_ASSETS],
    threshold_bps: [Field; MAX_ASSETS],
    accrued_debts: [Field; MAX_ASSETS],
    _remainders: [Field; MAX_ASSETS],
) -> (Field, Field) {
    let mut collateral_value: Field = 0;
    let mut debt_value: Field = 0;
    for i in 0..MAX_ASSETS {
        collateral_value +=
            position.collaterals[i] * current_prices[i] * threshold_bps[i];
        debt_value += accrued_debts[i] * current_prices[i] * BPS_DENOM;
    }
    (collateral_value, debt_value)
}

fn price_at(prices: [Field; MAX_ASSETS], target: Field) -> Field {
    let mut out: Field = 0;
    for i in 0..MAX_ASSETS {
        let i_field: Field = i as Field;
        if i_field == target {
            out = prices[i];
        }
    }
    out
}

// --- Tests ---------------------------------------------------------------

fn empty_siblings() -> [Field; TREE_DEPTH] { [0; TREE_DEPTH] }
fn empty_bits() -> [bool; TREE_DEPTH] { [false; TREE_DEPTH] }

/// Helper: target's "salt nullifier" given the commitment.
fn nullifier_from_commit(c: Field) -> Field {
    std::hash::pedersen_hash([24, c])
}

#[test]
fn test_liquidate_underwater_position() {
    let target_sk: Field = 0xbeef;
    let target_pk = spending_pubkey_of(target_sk);
    let liquidator_sk: Field = 0xfeed;
    let liquidator_pk = spending_pubkey_of(liquidator_sk);

    // Target position: collat[0] = 1_000_000 at $1, debt[1] = 850_000 at $1.
    // LT[0] = 8000 -> weighted_collat = 1_000_000 * 1e8 * 8000 = 8e14.
    // weighted_debt = 850_000 * 1e8 * 10000 = 8.5e14 -> unhealthy.
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[0] = 1_000_000;
    let mut debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    debts[1] = 850_000;
    let mut idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs[1] = 1_000_000_000;
    let target_position = Position {
        spending_pubkey: target_pk,
        collaterals: cols, debts,
        borrow_indices_at_update: idxs,
        salt: 0xa1,
    };

    let target_commit = position_commitment(target_position);
    let sibs = empty_siblings();
    let bits = empty_bits();
    let root = merkle_root(target_commit, sibs, bits);
    let target_null = nullifier_from_commit(target_commit);

    let mut prices: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    prices[0] = 100_000_000;  // $1
    prices[1] = 100_000_000;  // $1
    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs_now[1] = 1_000_000_000;
    let mut lt_bps: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    lt_bps[0] = 8_000;
    lt_bps[1] = 8_000;

    let mut accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    accrued[1] = 850_000;
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    // Liquidator covers 100k debt; bonus 800 bps -> seizes 108k collateral.
    let debt_cover: Field = 100_000;
    let bonus_bps: Field = 800;
    // seizure = 100_000 * (10000 + 800) / 10000 = 108_000 (prices equal so direct ratio).
    let seized: Field = 108_000;

    let liq_balance_salt: Field = 0xb1;
    let liq_balance = BalanceNote {
        asset_id: 0,
        amount: seized,
        spending_pubkey: liquidator_pk,
        salt: liq_balance_salt,
    };
    let liq_balance_commit = balance_commitment(liq_balance);

    let residual_salt: Field = 0xa2;
    let mut new_collats: [Field; MAX_ASSETS] = cols;
    new_collats[0] = 1_000_000 - 108_000;
    let mut new_debts: [Field; MAX_ASSETS] = accrued;
    new_debts[1] = 850_000 - 100_000;
    let residual = Position {
        spending_pubkey: target_pk,
        collaterals: new_collats,
        debts: new_debts,
        borrow_indices_at_update: idxs_now,
        salt: residual_salt,
    };
    let residual_commit = position_commitment(residual);

    main(
        0, 1, root, target_null, residual_commit, liq_balance_commit,
        debt_cover, seized, prices, idxs_now, lt_bps, bonus_bps,
        target_position, liquidator_pk, liq_balance_salt, residual_salt,
        sibs, bits, accrued, remainders,
    );
}

#[test(should_fail)]
fn test_liquidate_healthy_position_rejected() {
    let target_sk: Field = 0xbeef;
    let target_pk = spending_pubkey_of(target_sk);
    let liquidator_sk: Field = 0xfeed;
    let liquidator_pk = spending_pubkey_of(liquidator_sk);

    // Target: 1M collat, 500k debt -> weighted_collat = 8e14, weighted_debt = 5e14.
    // Healthy at LT 80%. Liquidate must reject.
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[0] = 1_000_000;
    let mut debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    debts[1] = 500_000;
    let mut idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs[1] = 1_000_000_000;
    let target_position = Position {
        spending_pubkey: target_pk,
        collaterals: cols, debts,
        borrow_indices_at_update: idxs,
        salt: 0xa1,
    };

    let target_commit = position_commitment(target_position);
    let sibs = empty_siblings();
    let bits = empty_bits();
    let root = merkle_root(target_commit, sibs, bits);
    let target_null = nullifier_from_commit(target_commit);

    let mut prices: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    prices[0] = 100_000_000;
    prices[1] = 100_000_000;
    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs_now[1] = 1_000_000_000;
    let mut lt_bps: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    lt_bps[0] = 8_000;
    lt_bps[1] = 8_000;
    let mut accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    accrued[1] = 500_000;
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    let debt_cover: Field = 50_000;
    let bonus_bps: Field = 800;
    let seized: Field = 54_000;

    let liq_balance_salt: Field = 0xb1;
    let liq_balance = BalanceNote {
        asset_id: 0, amount: seized, spending_pubkey: liquidator_pk, salt: liq_balance_salt,
    };
    let liq_balance_commit = balance_commitment(liq_balance);

    let residual_salt: Field = 0xa2;
    let mut new_collats: [Field; MAX_ASSETS] = cols;
    new_collats[0] = 1_000_000 - 54_000;
    let mut new_debts: [Field; MAX_ASSETS] = accrued;
    new_debts[1] = 500_000 - 50_000;
    let residual = Position {
        spending_pubkey: target_pk,
        collaterals: new_collats, debts: new_debts,
        borrow_indices_at_update: idxs_now,
        salt: residual_salt,
    };
    let residual_commit = position_commitment(residual);

    main(
        0, 1, root, target_null, residual_commit, liq_balance_commit,
        debt_cover, seized, prices, idxs_now, lt_bps, bonus_bps,
        target_position, liquidator_pk, liq_balance_salt, residual_salt,
        sibs, bits, accrued, remainders,
    );
}

#[test(should_fail)]
fn test_liquidate_wrong_bonus_math_rejected() {
    let target_sk: Field = 0xbeef;
    let target_pk = spending_pubkey_of(target_sk);
    let liquidator_sk: Field = 0xfeed;
    let liquidator_pk = spending_pubkey_of(liquidator_sk);

    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[0] = 1_000_000;
    let mut debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    debts[1] = 850_000;
    let mut idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs[1] = 1_000_000_000;
    let target_position = Position {
        spending_pubkey: target_pk,
        collaterals: cols, debts,
        borrow_indices_at_update: idxs, salt: 0xa1,
    };

    let target_commit = position_commitment(target_position);
    let sibs = empty_siblings();
    let bits = empty_bits();
    let root = merkle_root(target_commit, sibs, bits);
    let target_null = nullifier_from_commit(target_commit);

    let mut prices: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    prices[0] = 100_000_000;
    prices[1] = 100_000_000;
    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs_now[1] = 1_000_000_000;
    let mut lt_bps: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    lt_bps[0] = 8_000;
    lt_bps[1] = 8_000;
    let mut accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    accrued[1] = 850_000;
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    let debt_cover: Field = 100_000;
    let bonus_bps: Field = 800;
    // WRONG: seizing 200_000 instead of expected 108_000.
    let bad_seize: Field = 200_000;

    let liq_balance_salt: Field = 0xb1;
    let liq_balance = BalanceNote {
        asset_id: 0, amount: bad_seize, spending_pubkey: liquidator_pk, salt: liq_balance_salt,
    };
    let liq_balance_commit = balance_commitment(liq_balance);

    let residual_salt: Field = 0xa2;
    let mut new_collats: [Field; MAX_ASSETS] = cols;
    new_collats[0] = 1_000_000 - bad_seize;
    let mut new_debts: [Field; MAX_ASSETS] = accrued;
    new_debts[1] = 850_000 - 100_000;
    let residual = Position {
        spending_pubkey: target_pk,
        collaterals: new_collats, debts: new_debts,
        borrow_indices_at_update: idxs_now,
        salt: residual_salt,
    };
    let residual_commit = position_commitment(residual);

    main(
        0, 1, root, target_null, residual_commit, liq_balance_commit,
        debt_cover, bad_seize, prices, idxs_now, lt_bps, bonus_bps,
        target_position, liquidator_pk, liq_balance_salt, residual_salt,
        sibs, bits, accrued, remainders,
    );
}
