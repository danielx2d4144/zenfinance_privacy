#!/bin/bash
# Day 14c-E: keep Anvil Oracle prices fresh while the user is clicking
# through the dapp. The Oracle's MAX_STALENESS_WINDOW is 3600s; we push
# every 5 minutes so getPrice() never trips PriceStale during a test.
#
# Usage: bash code/infra/data-stack/keep-oracle-fresh.sh
# Loop forever; ^C to stop.
set -e
ORACLE=0x0165878a594ca255338adfa4d48449f69242eb8f
RPC=http://127.0.0.1:8545
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
INTERVAL=${INTERVAL:-300}

while true; do
  ts=$(date +'%H:%M:%S')
  if cast send "$ORACLE" "pushPrice(uint8,uint128)" 0 100000000 \
       --rpc-url "$RPC" --private-key "$PK" >/dev/null 2>&1 \
     && cast send "$ORACLE" "pushPrice(uint8,uint128)" 1 6000000000000 \
       --rpc-url "$RPC" --private-key "$PK" >/dev/null 2>&1; then
    echo "[$ts] oracle prices refreshed (USDC=\$1, cbBTC=\$60k)"
  else
    echo "[$ts] WARN price refresh failed (Oracle not deployed? Anvil down?)"
  fi
  sleep "$INTERVAL"
done
