# ZenFinance Deployment Guide

**Date:** 2026-08-26  
**Version:** v3.0 (Stork Oracle Integration)  
**Network:** Horizen Testnet (Chain ID: 2651420)

---

## Prerequisites

✅ Contracts deployed (v3.0 with Stork, block 26008305)  
✅ Backend API fixed (VK hashes synced, IMT hydration added)  
✅ Frontend fixed (cross-session supply flow working)  

---

## Deployment Architecture

```
┌─────────────────┐
│  Vercel (dapp)  │ ─────┐
└─────────────────┘      │
                         ├──> Horizen Testnet (2651420)
┌─────────────────┐      │    - PrivacyEntry: 0xF774...E14b
│ Railway (API)   │ ─────┘    - Oracle: 0xef55...a9a2
└─────────────────┘           - Stork: 0xacC0...d62
        │
        v
┌─────────────────┐
│   PostgreSQL    │
└─────────────────┘
```

---

## Part 1: Deploy Backend API (Railway)

### 1.1 Prepare the API

```bash
cd "C:\Users\Hi\Desktop\team idea\code\backend\data-api"

# Build
npm run build

# Test locally first
npm start
```

Expected output:
```
Server listening on http://127.0.0.1:8787
```

### 1.2 Environment Variables for Railway

Create these environment variables in Railway:

```env
# Server
PORT=8787
HOST=0.0.0.0
LOG_LEVEL=info

# Database (Railway will provide DATABASE_URL)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# API Key (rotate this for production)
API_KEY=cWm5TykwcAP9rClKlhes9d9ojtoVhbpoc91DGfBjWhU

# CORS - Update with your Vercel domain
CORS_ORIGINS=https://zenfinance.vercel.app,http://localhost:3000

# Chain
CHAIN_HTTPS=https://horizen-testnet.rpc.caldera.xyz/http
CHAIN_ID=2651420

# Relayer wallet (funded with 0.11 ETH)
RELAYER_PRIVATE_KEY=0x9d15a923fe919eb5bb2f847afe138955cd996ddd4b3ae25e312168e222427173

# Contract addresses (v3.0 deployment)
PRIVACY_ENTRY_ADDRESS=0xF774Ef76f52C819aA1cD14385F4D4Bc04Ec8E14b
MOCK_USDC_ADDRESS=0xdE21524EADf00d726a69Ac5Ebd97cE02735d8391
SHIELDED_SUPPLY_POOL_ADDRESS=0xd3900432F473f9367DC837d403Dd04D3Dd629db0
SHIELDED_POSITION_POOL_ADDRESS=0x42e8e79a7C0071930dAb7569100a7B4f4A674d09
LIQUIDATION_BOARD_ADDRESS=0x139f5D6316f5c9C95Bb6070cC2710dBBD4a8C173
ZK_VERIFIER_ADDRESS=0x8c8C4c860EF9749D7BaF82C35ef78232BDbd5077

# Attestation mode (real Kurier path to zkVerify)
ATTESTATION_MODE=kurier
MOCK_PROXY_ADDRESS=
ZK_DOMAIN_ID=175

# Kurier API
KURIER_BASE_URL=https://relayer-api-testnet.horizenlabs.io/api/v1
KURIER_API_KEY=d867e976ae55dde39f65641f675f26081529ef44
KURIER_POLL_INTERVAL_MS=5000
KURIER_POLL_TIMEOUT_MS=1200000
```

### 1.3 Deploy to Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link project (or create new)
railway link

# Deploy
railway up
```

### 1.4 Run Migrations

After deployment:

```bash
railway run npm run migrate:up
```

### 1.5 Verify Deployment

```bash
# Check health
curl https://your-api.railway.app/health

# Check VK hashes match chain
curl https://your-api.railway.app/api/vk-hashes
```

Expected: All 11 VK hashes should match on-chain `VkRegistry.sol`.

---

## Part 2: Deploy Frontend (Vercel)

### 2.1 Update Environment Variables

Create `.env.production` in `code/dapp/`:

```env
# Point to Horizen testnet
NEXT_PUBLIC_DEFAULT_CHAIN_ID=2651420

# RPC endpoints
NEXT_PUBLIC_HORIZEN_TESTNET_RPC=https://horizen-testnet.rpc.caldera.xyz/http
NEXT_PUBLIC_WC_PROJECT_ID=6eb6ae742bc035ee97b31f1eca90a02e

# Backend API (update with Railway URL)
NEXT_PUBLIC_API_BASE_URL=https://your-api.railway.app
NEXT_PUBLIC_API_KEY=cWm5TykwcAP9rClKlhes9d9ojtoVhbpoc91DGfBjWhU

# Contract addresses (v3.0)
NEXT_PUBLIC_HORIZEN_PRIVACY_ENTRY=0xF774Ef76f52C819aA1cD14385F4D4Bc04Ec8E14b
NEXT_PUBLIC_HORIZEN_MOCK_USDC=0xdE21524EADf00d726a69Ac5Ebd97cE02735d8391
NEXT_PUBLIC_HORIZEN_ORACLE=0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2
NEXT_PUBLIC_HORIZEN_RATE_MODEL=0xD03cE597a99Da3BA67e0D46c1d0243Cd5600F4f9
NEXT_PUBLIC_HORIZEN_ASSET_REGISTRY=0xDF0f2F7BF0D4eC09871E2cb1b10648561492dBff
NEXT_PUBLIC_HORIZEN_SHIELDED_SUPPLY_POOL=0xd3900432F473f9367DC837d403Dd04D3Dd629db0
NEXT_PUBLIC_HORIZEN_SHIELDED_POSITION_POOL=0x42e8e79a7C0071930dAb7569100a7B4f4A674d09
NEXT_PUBLIC_HORIZEN_ZKVERIFY_PROXY=0x3098A6974649478f0133046e44105AA84e868C21

# Deployment block for recovery scanning
NEXT_PUBLIC_HORIZEN_DEPLOY_BLOCK=26008305

# Disable admin panel in production
# NEXT_PUBLIC_ENABLE_ADMIN=false
```

### 2.2 Test Build Locally

```bash
cd "C:\Users\Hi\Desktop\team idea\code\dapp"

# Build (may take 5-10 minutes due to circuit artifacts)
npm run build

# Test production build locally
npm start
```

Visit `http://localhost:3000` and test:
1. Connect wallet
2. Deposit USDC
3. Logout
4. Login again
5. Supply USDC (should work now!)

### 2.3 Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

Or push to GitHub and connect the repo to Vercel dashboard.

### 2.4 Update Railway CORS

After getting Vercel URL, update Railway's `CORS_ORIGINS`:

```env
CORS_ORIGINS=https://zenfinance.vercel.app,http://localhost:3000
```

---

## Part 3: Seed Oracle & Initialize Contracts

### 3.1 Seed Oracle Prices

**Option A: Forge Script**

```bash
cd "C:\Users\Hi\Desktop\team idea\code\contracts"

forge script script/SeedOracleV1_2.s.sol \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --private-key $ADMIN_PRIVATE_KEY \
  --broadcast
```

**Option B: Admin UI** (if enabled)

1. Navigate to `https://zenfinance.vercel.app/admin`
2. Connect admin wallet (`0x4c2923d698a79dd85E900BCD9fDDb3Ef4973041e`)
3. Push USDC price: $1.00
4. Push cbBTC price: $60,000

### 3.2 Grant Oracle Manager Role (if needed)

```bash
forge script script/GrantOracleManager.s.sol \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --private-key $ADMIN_PRIVATE_KEY \
  --broadcast
```

### 3.3 Initialize Rate Models (if needed)

```bash
forge script script/InitializeRateModelV1_2.s.sol \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --private-key $ADMIN_PRIVATE_KEY \
  --broadcast
```

---

## Part 4: Verification & Testing

### 4.1 Health Checks

```bash
# API health
curl https://your-api.railway.app/health

# Check VK hashes
curl https://your-api.railway.app/api/vk-hashes | jq

# Check relayer balance
cast balance 0xB19f1F29DdC0C5248DE5bA98dDa4f94f9a562707 \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http
```

### 4.2 End-to-End Flow Test

1. **Open dapp:** `https://zenfinance.vercel.app`
2. **Connect wallet** (MetaMask on Horizen Testnet)
3. **Get testnet USDC:**
   ```bash
   cast send 0xdE21524EADf00d726a69Ac5Ebd97cE02735d8391 \
     "mint(address,uint256)" YOUR_ADDRESS 1000000000 \
     --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
     --private-key YOUR_KEY
   ```
4. **Deposit 100 USDC** → wait for confirmation
5. **Logout**
6. **Login again** → unlock spending key
7. **Supply 50 USDC** → should reach `confirmed` status ✅

### 4.3 Monitor Logs

**Railway logs:**
```bash
railway logs
```

Watch for:
- ✅ No `VkHashMismatch` errors
- ✅ Intents reaching `confirmed` status
- ❌ `getPrice reverted` → Oracle not seeded
- ❌ `Cannot satisfy constraint` → IMT sync issue

**Browser console:**
- ✅ `[useSpendingKey] IMT hydrated: { entryCount: 1, ... }`
- ❌ `Cannot satisfy constraint` → File a bug

---

## Part 5: Post-Deployment

### 5.1 Update CORS

Once you know the final Vercel URL, update Railway's `CORS_ORIGINS`.

### 5.2 Monitor Success Metrics

- **Supply intent success rate:** Target >95%
- **Cross-session operations:** Working for deposit → supply
- **Average confirmation time:** ~20-30 seconds (Kurier → zkVerify → Horizen)

### 5.3 Known Limitations

**Working:**
- ✅ Deposit → supply (same session)
- ✅ Deposit → logout → supply (cross-session) **[NEW FIX]**

**Not yet working (cross-session):**
- ❌ Withdraw supply (if supply was in previous session)
- ❌ Borrow (if collateral was in previous session)
- ❌ Repay (if borrow was in previous session)

**Workaround:** Complete full flows in one session until `supplyImt` and `positionImt` hydration is added.

### 5.4 Documentation

Update the following files:
- [ ] README.md with deployment status
- [ ] CHANGELOG.md with v3.0 release notes
- [ ] Add troubleshooting guide for common errors

---

## Rollback Plan

### If API Issues

```bash
# Railway: Rollback to previous deployment
railway rollback

# Or revert locally and redeploy
git revert HEAD
cd code/backend/data-api
npm run build
railway up
```

### If Frontend Issues

```bash
# Vercel: Use dashboard to rollback to previous deployment

# Or revert locally
git revert HEAD
cd code/dapp
npm run build
vercel --prod
```

**Impact:** Users revert to same-session-only operations.

---

## Monitoring & Alerts

### Set up monitoring for:

1. **API uptime** (Railway dashboard)
2. **Relayer balance** (alert if < 0.01 ETH)
3. **Intent success rate** (PostgreSQL query)
4. **zkVerify attestation failures** (Kurier logs)
5. **VK hash drift** (automated daily check)

### Alert thresholds:

- Intent failure rate > 10% → investigate
- Relayer balance < 0.01 ETH → refund
- API downtime > 5 minutes → page on-call

---

## Support & Troubleshooting

### Common Errors

**"VkHashMismatch"**
- Cause: VK registry out of sync with circuits
- Fix: Redeploy contracts or update VK hashes

**"Cannot satisfy constraint"**
- Cause: IMT not hydrated after cross-session recovery
- Fix: Already fixed in this deployment; check browser console for hydration logs

**"getPrice reverted with no data"**
- Cause: Oracle prices expired (hourly expiry)
- Fix: Run `SeedOracleV1_2.s.sol` or use admin UI

**"NullifierAlreadySpent"**
- Cause: User retrying failed intent
- Expected: Normal behavior, ignore

---

## Next Steps

1. **Complete IMT hydration:** Add `supplyImt` and `positionImt` recovery
2. **Stork integration:** Switch from manual oracle seeding to Stork feeds
3. **Mainnet deployment:** After 1 week of stable testnet operation
4. **Monitoring dashboard:** Build admin dashboard for intent tracking

---

## Contact

- **Deployed by:** danielx2d4144
- **Deployment date:** 2026-08-26
- **Chain:** Horizen Testnet (2651420)
- **Version:** v3.0 (Stork Oracle)

---

## Checklist

### Pre-deployment
- [x] VK hashes synced
- [x] IMT hydration added
- [x] Local testing passed
- [ ] Staging environment tested

### Deployment
- [ ] Railway API deployed
- [ ] PostgreSQL migrated
- [ ] Vercel frontend deployed
- [ ] CORS configured
- [ ] Oracle seeded
- [ ] Rate models initialized

### Post-deployment
- [ ] Health checks passed
- [ ] End-to-end flow tested
- [ ] Monitoring set up
- [ ] Documentation updated
- [ ] Team notified

---

**Ready to deploy!** Start with Part 1 (Railway API), then Part 2 (Vercel), then Part 3 (Oracle seeding).
