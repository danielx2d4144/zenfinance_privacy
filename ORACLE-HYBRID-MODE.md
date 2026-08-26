# Oracle Configuration Status - V3 Deployment

## Current Status: Hybrid Mode (Manual Prices)

**Date**: 2026-08-24  
**Oracle Address**: `0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2`  
**Stork Contract**: `0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62`

## Why Hybrid Mode?

The Stork contract is deployed on Horizen testnet, but it **doesn't have price data** for USDC/BTC feeds yet. The Stork contract reverts with error `0xc5723b51` when queried.

## Current Configuration

✅ **Stork feeds disabled** - Set to `bytes32(0)` to fall back to manual prices  
✅ **Manual price pushing enabled** - Admin has MANAGER_ROLE  
✅ **Prices working** - USDC: $1.00, BTC: $79,000  

## How It Works

1. Oracle checks for Stork feed ID
2. If feed ID is `bytes32(0)`, uses manual prices from `_priceData` mapping
3. Prices are pushed via `pushPrice()` function
4. Staleness window: 1 hour (3600 seconds)

## Price Refresh (Every 30-60 minutes)

```bash
cd code/contracts
forge script script/RefreshOraclePrices.s.sol \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --broadcast --legacy
```

Or set up a cron job:
```bash
*/30 * * * * cd /path/to/contracts && forge script script/RefreshOraclePrices.s.sol --rpc-url $RPC_URL --broadcast --legacy
```

## Migration to Full Stork (Future)

Once Stork enables price feeds on Horizen:

1. Contact Stork team with your API key
2. Request USDC and BTC feeds on Horizen testnet (chain ID 2651420)
3. Re-enable feeds:
   ```solidity
   oracle.setStorkFeed(0, 0x7416a56f222e196d0487dce8a1a8003936862e7a15092a91898d69fa8bce290c); // USDC
   oracle.setStorkFeed(1, 0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de); // BTC
   ```
4. Prices will automatically pull from Stork
5. No keeper needed

## For Mainnet Launch

Stork should have feeds enabled on Horizen mainnet. Deploy with Stork from day 1 using the same script we created (`DeployHorizenTestnetV3_Stork.s.sol`).

## Commands

**Check current price:**
```bash
cast call 0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2 "getPrice(uint8)(uint128)" 0 --rpc-url https://horizen-testnet.rpc.caldera.xyz/http
```

**Check Stork feed ID:**
```bash
cast call 0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2 "storkFeedId(uint8)(bytes32)" 0 --rpc-url https://horizen-testnet.rpc.caldera.xyz/http
```

**Manual price update:**
```bash
cast send 0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2 \
  "pushPrice(uint8,uint128)" 0 100000000 \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --private-key $DEPLOYER_PRIVATE_KEY --legacy
```

## Troubleshooting

- **Error 0x0868dfcf (PriceStale)**: Run `RefreshOraclePrices.s.sol`
- **Error 0xc5723b51**: Stork contract has no data - use hybrid mode (this document)
- **Supply works but borrow fails**: Refresh prices for both USDC and BTC
