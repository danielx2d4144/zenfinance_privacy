# Deploy Now - Quick Start

## Step 1: Railway (Backend API) - 5 minutes

1. **Go to:** https://railway.app/new
2. **Sign in** with GitHub
3. **Click:** "Deploy from GitHub repo"
4. **Select:** your `team-idea` repository
5. **Root directory:** `code/backend/data-api`
6. **Add PostgreSQL:**
   - Click "New" → "Database" → "PostgreSQL"
   - Railway auto-connects it via `DATABASE_URL`

7. **Add Environment Variables** (click "Variables" tab):
   ```
   PORT=8787
   HOST=0.0.0.0
   LOG_LEVEL=info
   API_KEY=cWm5TykwcAP9rClKlhes9d9ojtoVhbpoc91DGfBjWhU
   CORS_ORIGINS=http://localhost:3000
   CHAIN_HTTPS=https://horizen-testnet.rpc.caldera.xyz/http
   CHAIN_ID=2651420
   RELAYER_PRIVATE_KEY=0x9d15a923fe919eb5bb2f847afe138955cd996ddd4b3ae25e312168e222427173
   PRIVACY_ENTRY_ADDRESS=0xF774Ef76f52C819aA1cD14385F4D4Bc04Ec8E14b
   MOCK_USDC_ADDRESS=0xdE21524EADf00d726a69Ac5Ebd97cE02735d8391
   SHIELDED_SUPPLY_POOL_ADDRESS=0xd3900432F473f9367DC837d403Dd04D3Dd629db0
   SHIELDED_POSITION_POOL_ADDRESS=0x42e8e79a7C0071930dAb7569100a7B4f4A674d09
   LIQUIDATION_BOARD_ADDRESS=0x139f5D6316f5c9C95Bb6070cC2710dBBD4a8C173
   ZK_VERIFIER_ADDRESS=0x8c8C4c860EF9749D7BaF82C35ef78232BDbd5077
   ATTESTATION_MODE=kurier
   MOCK_PROXY_ADDRESS=
   ZK_DOMAIN_ID=175
   KURIER_BASE_URL=https://relayer-api-testnet.horizenlabs.io/api/v1
   KURIER_API_KEY=d867e976ae55dde39f65641f675f26081529ef44
   KURIER_POLL_INTERVAL_MS=5000
   KURIER_POLL_TIMEOUT_MS=1200000
   ```

8. **Deploy!** Railway will build and deploy automatically

9. **Run migrations:**
   - Go to your project → "Settings" → "Deploy Logs"
   - Wait for deploy to finish
   - Click "Variables" → note your Railway service URL
   - Open terminal and run:
     ```bash
     # Install Railway CLI
     npm install -g @railway/cli
     
     # Login and link
     railway login
     cd code/backend/data-api
     railway link
     
     # Run migrations
     railway run npm run migrate:up
     ```

10. **Copy your Railway URL** (e.g., `https://your-app.railway.app`)

---

## Step 2: Vercel (Frontend) - 5 minutes

1. **Go to:** https://vercel.com/new
2. **Sign in** with GitHub
3. **Click:** "Import Project"
4. **Select:** your `team-idea` repository
5. **Root directory:** `code/dapp`
6. **Framework:** Next.js (auto-detected)

7. **Add Environment Variables** (click "Environment Variables"):
   ```
   NEXT_PUBLIC_DEFAULT_CHAIN_ID=2651420
   NEXT_PUBLIC_HORIZEN_TESTNET_RPC=https://horizen-testnet.rpc.caldera.xyz/http
   NEXT_PUBLIC_WC_PROJECT_ID=6eb6ae742bc035ee97b31f1eca90a02e
   NEXT_PUBLIC_API_BASE_URL=<YOUR_RAILWAY_URL_FROM_STEP_1>
   NEXT_PUBLIC_API_KEY=cWm5TykwcAP9rClKlhes9d9ojtoVhbpoc91DGfBjWhU
   NEXT_PUBLIC_HORIZEN_PRIVACY_ENTRY=0xF774Ef76f52C819aA1cD14385F4D4Bc04Ec8E14b
   NEXT_PUBLIC_HORIZEN_MOCK_USDC=0xdE21524EADf00d726a69Ac5Ebd97cE02735d8391
   NEXT_PUBLIC_HORIZEN_ORACLE=0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2
   NEXT_PUBLIC_HORIZEN_RATE_MODEL=0xD03cE597a99Da3BA67e0D46c1d0243Cd5600F4f9
   NEXT_PUBLIC_HORIZEN_ASSET_REGISTRY=0xDF0f2F7BF0D4eC09871E2cb1b10648561492dBff
   NEXT_PUBLIC_HORIZEN_SHIELDED_SUPPLY_POOL=0xd3900432F473f9367DC837d403Dd04D3Dd629db0
   NEXT_PUBLIC_HORIZEN_SHIELDED_POSITION_POOL=0x42e8e79a7C0071930dAb7569100a7B4f4A674d09
   NEXT_PUBLIC_HORIZEN_ZKVERIFY_PROXY=0x3098A6974649478f0133046e44105AA84e868C21
   NEXT_PUBLIC_HORIZEN_DEPLOY_BLOCK=26008305
   ```

8. **Deploy!** Vercel will build and deploy (may take 5-10 minutes)

9. **Copy your Vercel URL** (e.g., `https://zenfinance.vercel.app`)

10. **Update Railway CORS:**
    - Go back to Railway → Variables
    - Update `CORS_ORIGINS` to include your Vercel URL:
      ```
      CORS_ORIGINS=https://zenfinance.vercel.app,http://localhost:3000
      ```

---

## Step 3: Seed Oracle - 2 minutes

```bash
cd code/contracts

forge script script/SeedOracleV1_2.s.sol \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --broadcast \
  --private-key <YOUR_ADMIN_PRIVATE_KEY>
```

Or use the admin UI at your Vercel URL + `/admin`

---

## Step 4: Test! 🎉

1. Visit your Vercel URL
2. Connect wallet (MetaMask on Horizen Testnet)
3. Get testnet USDC:
   ```bash
   cast send 0xdE21524EADf00d726a69Ac5Ebd97cE02735d8391 \
     "mint(address,uint256)" YOUR_ADDRESS 1000000000 \
     --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
     --private-key YOUR_KEY
   ```
4. Deposit 100 USDC → wait for confirmation
5. Logout
6. Login again → unlock spending key
7. Supply 50 USDC → should work! ✅

---

## Troubleshooting

**Build fails on Vercel:**
- Check build logs for errors
- Circuit artifacts may cause timeout (this is expected, Vercel will retry)

**API not responding:**
- Check Railway logs
- Verify environment variables are set
- Check migrations ran successfully

**CORS errors:**
- Make sure Railway's `CORS_ORIGINS` includes your Vercel URL
- Redeploy Railway after updating

---

## Next Steps

- [ ] Monitor Railway logs for errors
- [ ] Test all lending flows
- [ ] Set up custom domain
- [ ] Enable monitoring alerts
- [ ] Update documentation with live URLs

**Total time:** ~15 minutes 🚀
