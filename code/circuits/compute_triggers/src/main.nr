//! compute_triggers circuit -- S02 sec.2 circuit 11 / S02 sec.6.
//!
//! Given a Position and current market state, derive the per-asset
//! liquidation trigger price array and prove it equals a published
//! `triggers[MAX_ASSETS]` value. The on-chain `LiquidationBoard` stores
//! this array so liquidators can permissionlessly discover unhealthy
//! positions.
//!
//! Public inputs:
//!   - position_commitment    (binds the trigger array to a known commitment)
//!   - current_prices         ([Field; MAX_ASSETS])
//!   - current_borrow_indices ([Field; MAX_ASSETS])
//!   - lt_bps                 ([Field; MAX_ASSETS])
//!   - triggers               ([Field; MAX_ASSETS]; one threshold price per
//!                              non-zero collateral slot, 0 elsewhere)
//!
//! Private inputs:
//!   - position
//!   - accrued_debts, accrual_remainders  (witness hints)

use lib_common::{
    check_accrual, check_triggers, Position, position_commitment, MAX_ASSETS,
};

fn main(
    position_commitment_pub: pub Field,
    current_prices: pub [Field; MAX_ASSETS],
    current_borrow_indices: pub [Field; MAX_ASSETS],
    lt_bps: pub [Field; MAX_ASSETS],
    triggers: pub [Field; MAX_ASSETS],
    position: Position,
    accrued_debts: [Field; MAX_ASSETS],
    accrual_remainders: [Field; MAX_ASSETS],
) {
    // 1. Position commitment binding.
    assert(position_commitment_pub == position_commitment(position));

    // 2. Accrual binding for every slot.
    for i in 0..MAX_ASSETS {
        check_accrual(
            position.debts[i],
            current_borrow_indices[i],
            position.borrow_indices_at_update[i],
            accrued_debts[i],
            accrual_remainders[i],
        );
    }

    // 3. Trigger derivation: per-asset solve.
    check_triggers(position, current_prices, lt_bps, accrued_debts, triggers);
}

// --- Tests ---------------------------------------------------------------

use lib_common::spending_pubkey_of;

#[test]
fn test_zero_collateral_slots_have_zero_trigger() {
    let sk: Field = 0xdead;
    let pk = spending_pubkey_of(sk);
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[0] = 1_000_000;  // only slot 0 has collateral
    let mut debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    debts[1] = 100_000;
    let mut idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs[1] = 1_000_000_000;
    let position = Position {
        spending_pubkey: pk,
        collaterals: cols, debts,
        borrow_indices_at_update: idxs,
        salt: 0xabc,
    };
    let commit = position_commitment(position);

    let mut prices: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    prices[0] = 100_000_000;
    prices[1] = 100_000_000;
    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs_now[1] = 1_000_000_000;
    let mut lt_bps: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    lt_bps[0] = 8_000;
    lt_bps[1] = 8_000;

    let mut accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    accrued[1] = 100_000;
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    // For slot 0 the trigger solves:
    //   trigger * 1_000_000 * 8000 + 0 == 100_000 * 100_000_000 * 10000
    //   trigger = (100_000 * 1e8 * 10000) / (1_000_000 * 8000)
    //           = 1e17 / 8e9
    //           = 1.25e7  (= $0.125 in 1e8 USD scale)
    let mut triggers: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    triggers[0] = 12_500_000;  // $0.125
    // Slots 1..7: collateral is zero -> trigger must be 0 (enforced in helper).

    main(commit, prices, idxs_now, lt_bps, triggers, position, accrued, remainders);
}

#[test(should_fail)]
fn test_wrong_trigger_value_rejected() {
    let sk: Field = 0xdead;
    let pk = spending_pubkey_of(sk);
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[0] = 1_000_000;
    let mut debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    debts[1] = 100_000;
    let mut idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs[1] = 1_000_000_000;
    let position = Position {
        spending_pubkey: pk,
        collaterals: cols, debts,
        borrow_indices_at_update: idxs,
        salt: 0xabc,
    };
    let commit = position_commitment(position);

    let mut prices: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    prices[0] = 100_000_000;
    prices[1] = 100_000_000;
    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs_now[1] = 1_000_000_000;
    let mut lt_bps: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    lt_bps[0] = 8_000;
    lt_bps[1] = 8_000;

    let mut accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    accrued[1] = 100_000;
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    // Wrong value (off by 2x).
    let mut triggers: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    triggers[0] = 25_000_000;

    main(commit, prices, idxs_now, lt_bps, triggers, position, accrued, remainders);
}

#[test(should_fail)]
fn test_nonzero_trigger_on_empty_slot_rejected() {
    let sk: Field = 0xdead;
    let pk = spending_pubkey_of(sk);
    let mut cols: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    cols[0] = 1_000_000;
    let mut debts: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    debts[1] = 100_000;
    let mut idxs: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs[1] = 1_000_000_000;
    let position = Position {
        spending_pubkey: pk,
        collaterals: cols, debts,
        borrow_indices_at_update: idxs,
        salt: 0xabc,
    };
    let commit = position_commitment(position);

    let mut prices: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    prices[0] = 100_000_000;
    prices[1] = 100_000_000;
    let mut idxs_now: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    idxs_now[1] = 1_000_000_000;
    let mut lt_bps: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    lt_bps[0] = 8_000;
    lt_bps[1] = 8_000;
    let mut accrued: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    accrued[1] = 100_000;
    let remainders: [Field; MAX_ASSETS] = [0; MAX_ASSETS];

    // Trigger[0] correct, but trigger[2] nonzero even though col[2] = 0.
    let mut triggers: [Field; MAX_ASSETS] = [0; MAX_ASSETS];
    triggers[0] = 12_500_000;
    triggers[2] = 999;  // must reject -- col[2] = 0

    main(commit, prices, idxs_now, lt_bps, triggers, position, accrued, remainders);
}
