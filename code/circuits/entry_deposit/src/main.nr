//! entry_deposit circuit -- S02 sec.2 circuit 01.
//!
//! Proves: a public deposit (`asset_id`, `amount`) produced exactly the public
//! `commitment`, which encodes a fresh BalanceNote owned by `spending_pubkey`.
//!
//! On-chain: `PrivacyEntry.deposit(token, amount, commitment)` checks the
//! aggregation proof binding the same public inputs.
//!
//! Public inputs (in declaration order, matching the leaf-bytes recipe in
//! S02 sec.7):
//!   - asset_id
//!   - amount
//!   - commitment        (= pedersen_hash(TAG_BALANCE_NOTE, asset_id, amount, spending_pubkey, salt))
//!
//! Private inputs:
//!   - spending_pubkey   (owner identifier; deposit doesn't need the secret key)
//!   - salt              (note freshness; CSPRNG-sampled per I-CRYPTO-3)

use lib_common::{balance_commitment, BalanceNote};

fn main(
    asset_id: pub Field,
    amount: pub Field,
    commitment: pub Field,
    spending_pubkey: Field,
    salt: Field,
) {
    // I-CRYPTO-3: a fresh salt is required for every note. Empty-salt
    // notes would collide deterministically and break unlinkability.
    assert(salt != 0);

    // Public amount must be non-zero -- matches PrivacyEntry's ZeroAmount guard.
    assert(amount != 0);

    let note = BalanceNote {
        asset_id,
        amount,
        spending_pubkey,
        salt,
    };
    let expected = balance_commitment(note);
    assert(commitment == expected);
}

// --- Tests ---------------------------------------------------------------

#[test]
fn test_happy_path_binds_commitment() {
    let asset_id = 0;
    let amount = 1_000_000;
    let spending_pubkey = 0x123;
    let salt = 0xabc;
    let note = BalanceNote { asset_id, amount, spending_pubkey, salt };
    let commitment = balance_commitment(note);
    main(asset_id, amount, commitment, spending_pubkey, salt);
}

#[test(should_fail)]
fn test_wrong_commitment_rejected() {
    let asset_id = 0;
    let amount = 1_000_000;
    let spending_pubkey = 0x123;
    let salt = 0xabc;
    // Wrong commitment (bumped by 1)
    let note = BalanceNote { asset_id, amount, spending_pubkey, salt };
    let bad = balance_commitment(note) + 1;
    main(asset_id, amount, bad, spending_pubkey, salt);
}

#[test(should_fail)]
fn test_tampered_amount_rejected() {
    let asset_id = 0;
    let amount = 1_000_000;
    let spending_pubkey = 0x123;
    let salt = 0xabc;
    let note = BalanceNote { asset_id, amount, spending_pubkey, salt };
    let commitment = balance_commitment(note);
    // Public amount changed from 1_000_000 to 999_999; commitment stays.
    main(asset_id, 999_999, commitment, spending_pubkey, salt);
}

#[test(should_fail)]
fn test_zero_salt_rejected() {
    let asset_id = 0;
    let amount = 1_000_000;
    let spending_pubkey = 0x123;
    let salt = 0;
    let note = BalanceNote { asset_id, amount, spending_pubkey, salt };
    let commitment = balance_commitment(note);
    main(asset_id, amount, commitment, spending_pubkey, salt);
}

#[test(should_fail)]
fn test_zero_amount_rejected() {
    let asset_id = 0;
    let amount = 0;
    let spending_pubkey = 0x123;
    let salt = 0xabc;
    let note = BalanceNote { asset_id, amount, spending_pubkey, salt };
    let commitment = balance_commitment(note);
    main(asset_id, amount, commitment, spending_pubkey, salt);
}

#[test]
fn test_different_asset_yields_different_commitment() {
    let amount = 1_000_000;
    let spending_pubkey = 0x123;
    let salt = 0xabc;
    let usdc_note = BalanceNote { asset_id: 0, amount, spending_pubkey, salt };
    let cbbtc_note = BalanceNote { asset_id: 1, amount, spending_pubkey, salt };
    assert(balance_commitment(usdc_note) != balance_commitment(cbbtc_note));
}
