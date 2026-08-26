# Stork Integration Plan for Production Launch

## Current Issue
Oracle prices are stale (17+ hours old). The `PriceStale` error is blocking all supply/borrow operations.

## Two Paths Forward

### Option A: Quick Fix - Ship This Week with Price Keeper ✅ FASTEST
**Timeline:** 1-2 hours  
**Pros:**
- Ship on schedule this week
- Minimal code changes
- Known working pattern

**Cons:**
- Need to run a keeper service (cron job every 30 minutes)
- Manual price updates
- Additional infrastructure

**Implementation:**
1. **Immediate fix** - Refresh prices now:
   ```bash
   cd code/contracts
   forge script script/RefreshOraclePrices.s.sol --rpc-url https://horizen-testnet.rpc.caldera.xyz/http --broadcast --legacy
   ```

2. **Set up keeper service** - Run this every 30 minutes:
   ```bash
   # Add to crontab or Railway scheduled job
   */30 * * * * cd /path/to/contracts && forge script script/RefreshOraclePrices.s.sol --rpc-url $RPC_URL --broadcast --legacy
   ```

3. **Ship and iterate** - Launch with keeper, migrate to Stork post-launch

---

### Option B: Production-Ready - Deploy with Stork Integration ⭐ RECOMMENDED
**Timeline:** 1-2 days (depending on Stork setup)  
**Pros:**
- No keeper service needed
- Automatic price updates from Stork's decentralized network
- Production-grade from day 1
- More secure (no centralized MANAGER_ROLE)

**Cons:**
- Requires Stork contract address on Horizen
- Need to redeploy all contracts
- 1-2 day delay

**Implementation Steps:**

#### Step 1: Get Stork Contract Address
Contact Stork team or check their docs for:
- Stork verifier contract address on **Horizen mainnet** (if launching to mainnet)
- Stork verifier contract address on **Horizen testnet** (if testing first)

Resources:
- Stork docs: https://docs.stork.network/
- Your Stork API key: [you mentioned you have one]

#### Step 2: Update Deployment Script
I created `DeployHorizenTestnetV3_Stork.s.sol` with:
- Stork integration enabled
- Proper feed ID configuration
- Feed IDs already set:
  - USDC: `keccak256("USDCUSD")`
  - BTC: `0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de`

**TODO:** Update line 24 in `DeployHorizenTestnetV3_Stork.s.sol`:
```solidity
address internal constant STORK_CONTRACT = 0x<STORK_ADDRESS_HERE>;
```

#### Step 3: Deploy
```bash
cd code/contracts
export STORK_CONTRACT=0x<stork_address>
forge script script/DeployHorizenTestnetV3_Stork.s.sol --rpc-url https://horizen-testnet.rpc.caldera.xyz/http --broadcast --legacy
```

#### Step 4: Update Frontend & Backend
- Update `code/dapp/.env.local` with new contract addresses
- Update `code/backend/data-api/.env` with new contract addresses
- Restart both services

#### Step 5: Test
The Oracle will now pull prices from Stork automatically - no keeper needed!

---

## My Recommendation

**For this week's launch:** Use Option A (Quick Fix)
- Refresh prices now to unblock testing
- Set up keeper service on Railway/cron
- Ship on schedule

**For production mainnet:** Use Option B (Stork)
- Get Stork address while testing with keeper
- Redeploy to mainnet with Stork integration
- No keeper infrastructure to maintain

---

## Immediate Action (Next 5 Minutes)

Run this to unblock your supply flow right now:

```bash
cd code/contracts
forge script script/RefreshOraclePrices.s.sol \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --broadcast --legacy
```

This gives you fresh prices (valid for 1 hour) so you can continue testing while deciding on Option A or B.

---

## Questions to Answer

1. **Do you have the Stork contract address for Horizen?**
   - If yes → Go with Option B (2 day timeline)
   - If no → Go with Option A, contact Stork team in parallel

2. **Are you launching to testnet or mainnet this week?**
   - Testnet → Use Option A, migrate to Stork before mainnet
   - Mainnet → Strongly recommend Option B (Stork)

3. **How critical is the 1-2 day delay for Stork integration?**
   - Can wait → Option B is better long-term
   - Must ship this week → Option A is pragmatic

---

## Files Created

1. `script/RefreshOraclePrices.s.sol` - Emergency price refresh
2. `script/DeployHorizenTestnetV3_Stork.s.sol` - Full Stork deployment
3. This plan document

---

## Next Steps

Let me know:
1. Which option you prefer
2. If you have the Stork contract address
3. If you need help setting up the keeper service (Option A)
