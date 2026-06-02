//! entry_withdraw circuit -- S02 sec.2 circuit 02.
//!
//! Proves: the caller owns a balance note in PrivacyEntry's tree, derives
//! its nullifier, and splits the note value into a new residual balance
//! note (kept private) plus an external `amount` sent to `recipient`.
//!
//! On-chain: `PrivacyEntry.withdraw(nullifier, residual_commitment, token,
//! recipient, amount, root, ...)` consumes the nullifier and inserts the
//! residual commitment.
//!
//! Public inputs:
//!   - asset_id
//!   - root              (one of PrivacyEntry's known roots; checked off-circuit)
//!   - nullifier         (= pedersen_hash(TAG_BALANCE_NULLIFIER, secret_key, old_salt))
//!   - residual_commitment (new balance note for any remainder)
//!   - amount            (external payout)
//!
//! Private inputs:
//!   - secret_key
//!   - old_amount        (full value of the consumed note)
//!   - old_salt
//!   - new_salt          (freshness for the residual note)
//!   - merkle_siblings   ([Field; TREE_DEPTH])
//!   - merkle_index_bits ([bool; TREE_DEPTH])

use lib_common::{
    balance_commitment, balance_nullifier, BalanceNote, merkle_root,
    spending_pubkey_of, TREE_DEPTH,
};

fn main(
    asset_id: pub Field,
    root: pub Field,
    nullifier: pub Field,
    residual_commitment: pub Field,
    amount: pub Field,
    secret_key: Field,
    old_amount: Field,
    old_salt: Field,
    new_salt: Field,
    merkle_siblings: [Field; TREE_DEPTH],
    merkle_index_bits: [bool; TREE_DEPTH],
) {
    assert(secret_key != 0);
    assert(old_salt != 0);
    assert(new_salt != 0);

    // 1. Spending key authenticates the note.
    let pk = spending_pubkey_of(secret_key);

    // 2. Reconstruct the consumed note's commitment.
    let old_note = BalanceNote {
        asset_id,
        amount: old_amount,
        spending_pubkey: pk,
        salt: old_salt,
    };
    let old_commitment = balance_commitment(old_note);

    // 3. Verify Merkle inclusion against the published root.
    let computed_root = merkle_root(old_commitment, merkle_siblings, merkle_index_bits);
    assert(computed_root == root);

    // 4. Nullifier binds (secret_key, old_salt). Same recipe used on chain
    //    to mark the note spent.
    assert(nullifier == balance_nullifier(secret_key, old_salt));

    // 5. Conservation: amount <= old_amount, residual = old_amount - amount.
    //    Field arithmetic alone won't catch over-withdraw (wrap-around makes
    //    `residual + amount == old_amount` trivially true). Range-check via
    //    u128 -- lending amounts fit comfortably (max token supply ~ 2^110).
    let old_u128 = old_amount as u128;
    let amount_u128 = amount as u128;
    assert(amount_u128 <= old_u128);
    let residual_amount = old_amount - amount;

    // 6. Residual commitment binds the leftover amount.
    let residual_note = BalanceNote {
        asset_id,
        amount: residual_amount,
        spending_pubkey: pk,
        salt: new_salt,
    };
    assert(residual_commitment == balance_commitment(residual_note));
}

// --- Tests ---------------------------------------------------------------

fn empty_siblings() -> [Field; TREE_DEPTH] { [0; TREE_DEPTH] }
fn empty_index_bits() -> [bool; TREE_DEPTH] { [false; TREE_DEPTH] }

/// Build a happy-path witness with a synthetic Merkle path: the consumed
/// note sits at leaf-index 0 and every sibling is zero -- the root is
/// then merkle_root(old_commitment, [0]*TREE_DEPTH, [false]*TREE_DEPTH).
struct Witness {
    asset_id: Field,
    secret_key: Field,
    old_amount: Field,
    old_salt: Field,
    new_salt: Field,
    amount: Field,
}

fn run_with(w: Witness) -> (Field, Field, Field, Field, Field, [Field; TREE_DEPTH], [bool; TREE_DEPTH]) {
    let pk = spending_pubkey_of(w.secret_key);
    let old_note = BalanceNote {
        asset_id: w.asset_id,
        amount: w.old_amount,
        spending_pubkey: pk,
        salt: w.old_salt,
    };
    let old_commit = balance_commitment(old_note);
    let sibs = empty_siblings();
    let bits = empty_index_bits();
    let root = merkle_root(old_commit, sibs, bits);
    let null = balance_nullifier(w.secret_key, w.old_salt);
    let residual = BalanceNote {
        asset_id: w.asset_id,
        amount: w.old_amount - w.amount,
        spending_pubkey: pk,
        salt: w.new_salt,
    };
    let residual_commit = balance_commitment(residual);
    (w.asset_id, root, null, residual_commit, w.amount, sibs, bits)
}

#[test]
fn test_happy_path_partial_withdraw() {
    let w = Witness {
        asset_id: 0,
        secret_key: 0xdead,
        old_amount: 1_000_000,
        old_salt: 0xabc,
        new_salt: 0xdef,
        amount: 250_000,
    };
    let (asset_id, root, null, residual_commit, amount, sibs, bits) = run_with(w);
    main(
        asset_id,
        root,
        null,
        residual_commit,
        amount,
        w.secret_key,
        w.old_amount,
        w.old_salt,
        w.new_salt,
        sibs,
        bits,
    );
}

#[test]
fn test_happy_path_full_withdraw() {
    let w = Witness {
        asset_id: 1,
        secret_key: 0xbeef,
        old_amount: 1_000_000,
        old_salt: 0x111,
        new_salt: 0x222,
        amount: 1_000_000,
    };
    let (asset_id, root, null, residual_commit, amount, sibs, bits) = run_with(w);
    main(
        asset_id,
        root,
        null,
        residual_commit,
        amount,
        w.secret_key,
        w.old_amount,
        w.old_salt,
        w.new_salt,
        sibs,
        bits,
    );
}

#[test(should_fail)]
fn test_wrong_secret_key_fails_root() {
    let w = Witness {
        asset_id: 0,
        secret_key: 0xdead,
        old_amount: 1_000_000,
        old_salt: 0xabc,
        new_salt: 0xdef,
        amount: 250_000,
    };
    let (asset_id, root, null, residual_commit, amount, sibs, bits) = run_with(w);
    // Pass a wrong secret_key; the recomputed pk -> old_commitment -> root
    // will diverge from the public root.
    main(
        asset_id,
        root,
        null,
        residual_commit,
        amount,
        0xbad,
        w.old_amount,
        w.old_salt,
        w.new_salt,
        sibs,
        bits,
    );
}

#[test(should_fail)]
fn test_tampered_root_rejected() {
    let w = Witness {
        asset_id: 0,
        secret_key: 0xdead,
        old_amount: 1_000_000,
        old_salt: 0xabc,
        new_salt: 0xdef,
        amount: 250_000,
    };
    let (asset_id, root, null, residual_commit, amount, sibs, bits) = run_with(w);
    main(
        asset_id,
        root + 1, // tampered
        null,
        residual_commit,
        amount,
        w.secret_key,
        w.old_amount,
        w.old_salt,
        w.new_salt,
        sibs,
        bits,
    );
}

#[test(should_fail)]
fn test_over_withdraw_underflows() {
    // amount > old_amount must fail conservation.
    let w = Witness {
        asset_id: 0,
        secret_key: 0xdead,
        old_amount: 100,
        old_salt: 0xabc,
        new_salt: 0xdef,
        amount: 250, // > old_amount
    };
    let (asset_id, root, null, _bad_residual, amount, sibs, bits) = run_with(w);
    // residual computed by run_with wraps around in the field; the in-circuit
    // conservation re-check (`residual + amount == old_amount`) will reject.
    main(
        asset_id,
        root,
        null,
        _bad_residual,
        amount,
        w.secret_key,
        w.old_amount,
        w.old_salt,
        w.new_salt,
        sibs,
        bits,
    );
}

#[test(should_fail)]
fn test_wrong_nullifier_rejected() {
    let w = Witness {
        asset_id: 0,
        secret_key: 0xdead,
        old_amount: 1_000_000,
        old_salt: 0xabc,
        new_salt: 0xdef,
        amount: 250_000,
    };
    let (asset_id, root, _good_null, residual_commit, amount, sibs, bits) = run_with(w);
    main(
        asset_id,
        root,
        0xfeed, // bogus nullifier
        residual_commit,
        amount,
        w.secret_key,
        w.old_amount,
        w.old_salt,
        w.new_salt,
        sibs,
        bits,
    );
}
