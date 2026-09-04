# Price Keeper Deployment Guide

## Problem
The Horizen testnet Oracle has a **60-second staleness window**. If prices aren't updated within 60 seconds, all transactions revert with `PriceStale` error. This affects all users of the deployed dapp, not just admins.

## Solution
Deploy the price-keeper as a **long-running service** that pushes prices every 45 seconds.

---

## Option 1: Railway Service (Recommended)

### Step 1: Create a New Railway Service

1. Go to your Railway dashboard: https://railway.app/dashboard
2. Select your existing project (where your data-api is deployed)
3. Click **"New"** → **"GitHub Repo"**
4. Select this repository
5. Railway will ask which service to deploy - create a new service called `price-keeper`

### Step 2: Configure the Service

1. In the Railway service settings, set **Root Directory** to: `code/backend/price-keeper`
2. The `railway.json` and `nixpacks.toml` files will automatically configure the build

### Step 3: Set Environment Variables

Go to the service's **Variables** tab and add these (from `.env.railway`):

```
HORIZEN_TESTNET_HTTPS=https://horizen-testnet.rpc.caldera.xyz/http
HORIZEN_TESTNET_CHAIN_ID=2651420
ORACLE_HORIZEN=0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2
HORIZEN_ASSET_IDS=0,1
HORIZEN_PUSH_INTERVAL_SECONDS=45
HORIZEN_MAX_AGE_SECONDS=50
RELAYER_PRIVATE_KEY=0x9d15a923fe919eb5bb2f847afe138955cd996ddd4b3ae25e312168e222427173
BTC_PRICE_URL=https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd
BTC_PRICE_TIMEOUT_MS=10000
```

⚠️ **Security Note**: Use Railway's encrypted variables for `RELAYER_PRIVATE_KEY`

### Step 4: Deploy

1. Railway will automatically deploy after you set the variables
2. Check the logs to confirm it's running: you should see `horizen-keeper-start` and periodic `horizen-keeper-sweep` messages
3. The service will run 24/7, pushing prices every 45 seconds

### Cost
Railway free tier includes 500 hours/month. This service uses ~720 hours/month (24/7), so you'll need the **Hobby plan ($5/month)** or the service will pause after ~21 days.

---

## Option 2: Railway Cron Job (Alternative)

If you want to use cron instead of a long-running service:

1. Create a new service as above
2. Change the **start command** to: `npm run horizen:push-once`
3. In Railway settings, set up a **Cron schedule**: `*/1 * * * *` (every minute)

**Note**: This is less reliable because cron runs only every minute, giving you only 1 push per minute instead of every 45 seconds. If a cron job is delayed, prices could go stale.

---

## Option 3: Increase Oracle Staleness Window (Not Recommended)

You could increase the Oracle's staleness window to match the cron interval:

```solidity
// On Horizen testnet, as contract admin:
// Call Oracle.setStalenessWindow(assetId, 3600) for each asset
```

**Why this is bad**:
- Stale prices = security risk (oracle attacks, bad liquidations)
- The 60-second window is intentional for safety
- Better to push frequently than to accept stale data

---

## Verification

After deployment, verify the keeper is working:

1. **Check Railway logs** - You should see:
   ```
   {"msg":"horizen-keeper-start"}
   {"msg":"horizen-keeper-sweep","pushed":[0,1],...}
   ```

2. **Test on-chain** - Prices should never be older than ~45 seconds:
   ```bash
   cast call 0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2 "getPrice(uint8)" 0 \
     --rpc-url https://horizen-testnet.rpc.caldera.xyz/http
   ```

3. **Test the dapp** - Supply/borrow transactions should work without `PriceStale` errors

---

## Troubleshooting

### "Keeper stopped after deployment"
- Check Railway logs for errors
- Verify all environment variables are set
- Ensure `RELAYER_PRIVATE_KEY` account has MANAGER_ROLE on the Oracle

### "Still getting PriceStale errors"
- Check if the keeper is actually running (Railway logs)
- Verify the keeper is pushing to the correct Oracle address
- Check if there's a clock skew issue (unlikely but possible)

### "Out of gas / transaction failed"
- The relayer wallet (0xB19f1F29DdC0C5248DE5bA98dDa4f94f9a562707) needs ETH for gas
- Check balance: https://horizen-testnet-explorer.caldera.xyz/address/0xB19f1F29DdC0C5248DE5bA98dDa4f94f9a562707
- Fund it from the faucet if needed

---

## Next Steps

1. Deploy to Railway following Option 1 above
2. Commit the new config files to git
3. Monitor for 24 hours to ensure stability
4. Inform testers that the app is now continuously maintained
