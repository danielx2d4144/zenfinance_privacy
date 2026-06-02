use lib_common::{balance_commitment, BalanceNote};

fn main(asset_id: Field, amount: Field, spending_pubkey: Field, salt: Field) -> pub Field {
    balance_commitment(BalanceNote { asset_id, amount, spending_pubkey, salt })
}
