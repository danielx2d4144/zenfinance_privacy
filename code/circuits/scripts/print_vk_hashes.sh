#!/usr/bin/env bash
# Print all 11 circuit vkHashes as `<name>  0x<hex>`.
set -euo pipefail
CIRCUITS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NAMES=(entry_deposit entry_withdraw supply_asset withdraw_supply deposit_collateral withdraw_collateral borrow repay liquidate consolidate_balance compute_triggers)
for c in "${NAMES[@]}"; do
    f="$CIRCUITS_DIR/$c/target/vk_hash"
    h=$(od -An -v -tx1 "$f" | tr -d ' \n')
    printf "%-22s 0x%s\n" "$c" "$h"
done
