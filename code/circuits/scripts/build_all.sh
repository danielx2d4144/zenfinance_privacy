#!/usr/bin/env bash
# Build all Day-4 circuits: compile, write VK, write Solidity verifier,
# copy into the contracts repo with disambiguated names.
#
# Run from inside WSL or a Linux shell where ~/.nargo/bin and ~/.bb are on PATH.
# From Windows Git Bash, prefix calls with:
#   MSYS_NO_PATHCONV=1 /c/Windows/System32/wsl.exe -d Ubuntu -- bash <this script>

set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS_VERIF_DIR="$CIRCUITS_DIR/../contracts/src/verifiers"

CIRCUITS=(
    "entry_deposit:EntryDeposit"
    "entry_withdraw:EntryWithdraw"
    "supply_asset:SupplyAsset"
    "withdraw_supply:WithdrawSupply"
    "deposit_collateral:DepositCollateral"
    "withdraw_collateral:WithdrawCollateral"
    "borrow:Borrow"
    "repay:Repay"
    "liquidate:Liquidate"
    "consolidate_balance:ConsolidateBalance"
    "compute_triggers:ComputeTriggers"
)

mkdir -p "$CONTRACTS_VERIF_DIR"

for entry in "${CIRCUITS[@]}"; do
    snake="${entry%%:*}"
    pascal="${entry##*:}"
    circuit_dir="$CIRCUITS_DIR/$snake"
    target_dir="$circuit_dir/target"

    echo
    echo "=== $snake -> ${pascal}Verifier ==="

    (cd "$circuit_dir" && nargo test)
    (cd "$circuit_dir" && nargo compile)

    bb write_vk \
        -b "$target_dir/$snake.json" \
        -o "$target_dir" \
        -t evm

    bb write_solidity_verifier \
        -k "$target_dir/vk" \
        -o "$target_dir/Verifier.sol"

    sed -E "s/contract HonkVerifier/contract ${pascal}Verifier/" \
        "$target_dir/Verifier.sol" > "$CONTRACTS_VERIF_DIR/${pascal}Verifier.sol"

    vk_hash="0x$(od -An -v -tx1 "$target_dir/vk_hash" | tr -d ' \n')"
    echo "  vkHash: $vk_hash"
done

echo
echo "All 11 circuits compiled, tested, and exported to $CONTRACTS_VERIF_DIR"
