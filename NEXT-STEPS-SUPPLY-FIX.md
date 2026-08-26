# Next Steps — Supply Flow Testing & Deployment

## Immediate Testing (Local)

### 1. Restart Relayer API
```bash
cd code/backend/data-api
npm run dev
```

### 2. Seed Oracle (Required)
The `getPrice` error needs to be resolved before testing:

**Option A: Forge Script**
```bash
cd code/contracts
forge script script/SeedOracleV1_2.s.sol --broadcast --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

**Option B: Admin UI**
1. Navigate to `http://localhost:3000/admin`
2. Connect admin wallet (`0x3b1498f4f855d7967D19C8B7D0e91D83EDaF8753`)
3. Click "2. Push USDC Price ($1.00)"
4. Click "3. Push cbBTC Price ($60,000)"

### 3. Test Supply Flow

**Test A: Same-session (should work now)**
1. Open dapp: `http://localhost:3000`
2. Connect wallet, unlock spending key
3. Deposit 100 USDC
4. Immediately supply 50 USDC
5. ✅ Should reach `confirmed` status

**Test B: Cross-session (the main fix)**
1. Session A: Deposit 100 USDC → wait for confirmation → logout
2. Session B: Unlock spending key
3. Check console for: `[useSpendingKey] IMT hydrated: { entryCount: 1, entryRoot: "0x..." }`
4. Supply 50 USDC
5. ✅ Should reach `confirmed` status (no "Cannot satisfy constraint")

---

## Verification

### Check IMT Root Matches Chain
After unlock, compare local vs on-chain root:

```javascript
// Browser console (after unlock)
console.log('Local entryImt root:', window.entryImt.currentRoot().toString(16));
```

```bash
# On-chain root
cast call 0x76F558d7632C23fc5d885939547bFD560Ad5d181 "currentRoot()" --rpc-url https://rpc.horizen-testnet.io
```

They should match exactly.

---

## Known Limitations (Post-Fix)

### Cross-session operations that still need work:
- ❌ **withdraw_supply** (if supply was created in a previous session)
- ❌ **borrow** (if collateral was deposited in a previous session)
- ❌ **repay** (if borrow was created in a previous session)
- ❌ **withdraw_collateral** (if collateral was deposited in a previous session)

**Why:** `supplyImt` and `positionImt` are not hydrated yet (only `entryImt` is fixed).

**Workaround:** Perform the full flow in one session:
1. Deposit → supply → withdraw_supply (all in session A) ✅
2. Deposit → deposit_collateral → borrow → repay (all in session A) ✅

---

## Follow-up PR: Complete IMT Hydration

### Tasks:
1. Update `recovery-scan.ts`:
   - Add `SupplyDeposited` event tracking → `ChainView.supplyLeaves`
   - Add `PositionUpdated` event tracking → `ChainView.positionLeaves`

2. Update `useSpendingKey.tsx`:
   - After `entryImt` hydration, add:
     ```typescript
     // Hydrate supplyImt
     const sortedSupplies = [...view.supplyLeaves].sort((a, b) => a.leafIndex - b.leafIndex);
     for (const { commitment } of sortedSupplies) {
       supplyImtRef.current.insert(BigInt(commitment));
     }

     // Hydrate positionImt
     const sortedPositions = [...view.positionLeaves].sort((a, b) => a.leafIndex - b.leafIndex);
     for (const { commitment } of sortedPositions) {
       positionImtRef.current.insert(BigInt(commitment));
     }
     ```

3. Add contract addresses to recovery-adapter:
   - `SHIELDED_SUPPLY_POOL_ADDRESS`
   - `SHIELDED_POSITION_POOL_ADDRESS`

4. Test all 6 lending flows across sessions

---

## Deployment Checklist

### Backend (Relayer API)
- [x] VK hashes updated in `vk-registry.ts`
- [ ] Deploy to production/Railway
- [ ] Verify all 11 VK hashes match on-chain `VkRegistry.sol`

### Frontend (Dapp)
- [x] IMT hydration added to `useSpendingKey.tsx`
- [ ] Deploy to Vercel/production
- [ ] Test deposit → logout → login → supply flow

### Contracts (Already Deployed v1.2)
- [ ] Seed Oracle with `SeedOracleV1_2.s.sol` OR admin UI
- [ ] Grant MANAGER_ROLE to relayer (if not done): `GrantOracleManager.s.sol`
- [ ] Initialize rate models (if not done): `InitializeRateModelV1_2.s.sol`

---

## Monitoring

### Success Metrics
- [ ] No more `VkHashMismatch` errors in relayer logs
- [ ] No more "Cannot satisfy constraint" errors in browser console
- [ ] Supply intents reach `confirmed` status (not `failed`)
- [ ] Cross-session supply completion rate > 95%

### Error Monitoring
Watch for:
- `VkHashMismatch` → VK drift detected (urgent)
- `Cannot satisfy constraint` → IMT sync issue (urgent)
- `getPrice reverted` → Oracle not seeded (blocking)
- `NullifierAlreadySpent` → Double-spend attempt (expected for re-tries)

---

## Rollback Plan

If issues arise:

### Relayer Rollback
```bash
git revert HEAD
cd code/backend/data-api
npm run build
npm run deploy
```

### Dapp Rollback
```bash
git revert HEAD
cd code/dapp
npm run build
# Redeploy to Vercel
```

**Impact:** Users revert to same-session-only operations (deposit + immediate supply).

---

## Documentation Updates Needed

- [ ] Update README with cross-session support status
- [ ] Add troubleshooting section for "Cannot satisfy constraint"
- [ ] Document IMT hydration architecture in design docs
- [ ] Update CHANGELOG.md with bug fix details

---

## Questions for User

1. **Should I proceed with the follow-up PR** to add supply/position event tracking and complete IMT hydration?
2. **Oracle seeding:** Do you want to use the Forge script or the admin UI?
3. **Testing environment:** Is there a staging environment, or should we test on mainnet after verifying on testnet?

---

## Contact

For issues or questions about this fix:
- Bug report: See `BUGFIX-SUPPLY-FLOW.md`
- Implementation details: Check commit `8d130ae`
- Original error logs: (attach if available)
