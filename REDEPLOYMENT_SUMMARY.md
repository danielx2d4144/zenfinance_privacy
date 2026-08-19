# Redeployment Summary — 2026-08-19

**Status:** ✅ COMPLETE  
**Deployment Block:** 25567620  
**Chain:** Horizen Testnet (2651420)

---

## What Was Done

### 1. ✅ VkRegistry.sol Updated
- All 11 VK hashes changed from Poseidon2 (3680 bytes) to Keccak format (1888 bytes)
- Matches Kurier-registered VKs exactly

### 2. ✅ Contracts Deployed
All 11 contracts deployed successfully:

| Contract | New Address |
|----------|-------------|
| ZkVerifier | `0x9FA34fCe202E311dc6c8E73244E365AEeF39cc94` |
| PrivacyEntry | `0x00735D96EDdE1707e2E7fe612B628B8B551F14c8` |
| ShieldedSupplyPool | `0xC64465c6a00C9F12895Ab3a8fD151324686D3dCF` |
| ShieldedPositionPool | `0x1539dB2620DB347A41fdd6a7f0d293bBDa9Bc919` |
| LiquidationBoard | `0x7Fb0c4305edd6E1fd0E158Abb64D6d824Fe26078` |
| AssetRegistry | `0x2Cd17ab848BcFddEb3EDbc99208777a6F03edda3` |
| RateModel | `0xeD652bD8347CdFb273abb132B06725cE8D9D871A` |
| Oracle | `0xe5cd6Ceea10baF0F3961b8e9B4AFd6acE3C03dAf` |
| InsuranceFund | `0x7C3fe8b0de8D085F8f2b8bf5532F805666689C95` |
| Mock USDC | `0x9D741b4aECBE3a5514a9b2cCC6bbA0Dc1C8169c0` |
| Mock cbBTC | `0xA181FF659A40697480F27B7dAe151bF3dA05794A` |

**Gas Used:** 32,729,500 (0.000032737 ZEN)

### 3. ✅ VK Hashes Verified On-Chain
Verified sample VK hashes match expectations:
- Circuit 0 (entry_deposit): `0x0063b1d0...` ✅
- Circuit 1 (entry_withdraw): `0x7f23d01f...` ✅
- Circuit 2 (supply_asset): `0x6d827ab8...` ✅
- Circuit 6 (borrow): `0xd8683cd6...` ✅
- Circuit 8 (liquidate): `0xac31cdb9...` ✅

### 4. ✅ Documentation Updated
- `docs/DEPLOYMENTS.md` - All addresses and VK hashes updated
- `REDEPLOYMENT_GUIDE.md` - Created deployment guide
- `GROUND_TRUTH.md` - Updated with 2026-08-19 status

### 5. ✅ Configuration Files Updated
- `code/dapp/.env.local` - Frontend contract addresses
- `code/backend/prover-service/.env` - ZkVerifier address
- `code/backend/data-api/.env.horizen` - All contract addresses
- `code/contracts/deployments/horizen-testnet-2651420.json` - Deployment manifest

---

## Verification Results

### On-Chain VK Hash Check
```bash
cast call 0x9FA34fCe202E311dc6c8E73244E365AEeF39cc94 \
  "vkHash(uint8)(bytes32)" 2 \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz

# Returns: 0x6d827ab8e9cda14748279168d08e083b72fa7469e8fe83226e5ccf77118be373
# Expected: 0x6d827ab8e9cda14748279168d08e083b72fa7469e8fe83226e5ccf77118be373
# ✅ MATCH
```

### Kurier VK Hash Check
All 11 circuits registered with Kurier on 2026-08-19 with Keccak format VKs.

---

## Next Steps (Phase 2 Completion)

### Immediate (Today)
1. **Test live supply proof** - Generate proof in browser, submit to Kurier
2. **Verify proof reaches Aggregated status** (~3 minutes)
3. **Confirm ProofConsumed event** fires on-chain

### Short-term (This Week)
4. **Test borrow proof** end-to-end
5. **Test full user flow** (deposit → supply → borrow → repay → withdraw)
6. **Update CHANGELOG.md** with redeployment details

### Phase 3 (Next Week)
7. Deploy backend to Railway
8. Deploy frontend to Vercel
9. Set up invite gate
10. Public testnet announcement

---

## Files Modified

```
code/contracts/src/libraries/VkRegistry.sol
code/dapp/.env.local
code/backend/prover-service/.env
code/backend/data-api/.env.horizen
docs/DEPLOYMENTS.md
GROUND_TRUTH.md
NEXT_STEPS.md
REDEPLOYMENT_GUIDE.md (new)
REDEPLOYMENT_SUMMARY.md (this file)
```

---

## Deployment Wallet

**Address:** `0x3b1498f4f855d7967D19C8B7D0e91D83EDaF8753`  
**Remaining Balance:** ~0.077 ZEN (after deployment)

---

## Explorer Links

**ZkVerifier:**  
https://horizen-testnet.explorer.caldera.xyz/address/0x9FA34fCe202E311dc6c8E73244E365AEeF39cc94

**PrivacyEntry:**  
https://horizen-testnet.explorer.caldera.xyz/address/0x00735D96EDdE1707e2E7fe612B628B8B551F14c8

**Deployment Transaction:**  
https://horizen-testnet.explorer.caldera.xyz/block/25567620

---

## Success Criteria

- ✅ All contracts deployed without errors
- ✅ VK hashes on-chain match Kurier-registered hashes
- ✅ Configuration files updated
- ✅ Documentation updated
- 🔄 Test proof reaches Aggregated status (PENDING)
- 🔄 ProofConsumed event emitted (PENDING)

---

**Status:** Ready for live proof testing!
