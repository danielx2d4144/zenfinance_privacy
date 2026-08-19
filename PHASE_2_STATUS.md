# Phase 2 Progress — VK Format Issue RESOLVED ✅

**Date:** 2026-08-19  
**Commit:** cc203a5

---

## What Was Blocking Us

Kurier was rejecting all proof submissions with `status=Failed`. We thought it was a bb.js version incompatibility, but the Horizen team clarified:

> "Our chain actually already supports the newer toolchain. The V3_0 variant supports bb.js 3.0.x, it is just not reflected in the Kurier docs yet. **Yours is probably not a version problem at all. Most likely you generated your VK without the EVM (keccak) format**, which is the default behavior on newer bb."

**Root cause:** bb.js defaults to **Poseidon2 format** (3680 bytes, designed for recursion), but zkVerify requires **Keccak format** (1888 bytes, for on-chain EVM verification).

---

## What We Fixed

### Code Changes (Committed)

1. **Browser prover** — `code/dapp/src/lib/prover/worker.ts`
   - Changed: `generateProof(witness, { keccakZK: true })`
   - Was: `generateProof(witness, {})`

2. **VK derivation script** — `code/dapp/scripts/derive-vks.mjs`
   - Changed: `oracleHashType: "keccak"`
   - Was: `oracleHashType: "poseidon2"`

3. **Regenerated all 11 VKs**
   - All now **1888 bytes** (Keccak format) ✅
   - Previously: 3680 bytes (Poseidon2 format) ❌

4. **Re-registered with Kurier**
   - All 11 circuits accepted ✅
   - Updated `kurier-vk-hashes.ts` with new hashes

5. **Recovery scan fix** — `code/dapp/src/hooks/useSpendingKey.tsx`
   - Incremental scan with localStorage cursor
   - Fixes 8-14s page load jank

### Documentation Created

- `VK_FIX_COMPLETE.md` — full resolution guide
- `BB_JS_DOWNGRADE_FINDINGS.md` — version compatibility investigation (turned out unnecessary)
- `BB_JS_STATUS_UPDATE.md` — summary for user
- `Fixing the VK Registration Issue (UltraHonk, 1888 vs 3680 bytes).md` — Horizen's official guide
- `docs/VELA_PROVING_INTEGRATION.md` — TEE proving implementation spec (validated as feasible)

---

## What's Next (Task #27)

### 1. Update VkRegistry.sol

The Keccak VK hashes are different from the old Poseidon2 hashes. Update `code/contracts/src/libraries/VkRegistry.sol`:

```solidity
// Day 4 circuits
bytes32 internal constant ENTRY_DEPOSIT          =
    0x2cb1a74389c8e9874bc7afb547715f84294b5b9ad4afda62f673f0d7723914d3;
bytes32 internal constant ENTRY_WITHDRAW         =
    0x1feea9cbba20ac77c4a57ce109b9f469ca66f28f9589336f5c374f5de1cb72f7;
bytes32 internal constant SUPPLY_ASSET           =
    0x25acc035ddd29df9141476091055fe4928d50e836c07ea723b4b8c02fbe7f7c6;
bytes32 internal constant WITHDRAW_SUPPLY        =
    0x18959383b7a911cc6a75759adcf9d3639ec3f9e5009438ae636c40718366889c;
bytes32 internal constant DEPOSIT_COLLATERAL     =
    0x2f711a9ef305f88bf6f01c2110430f47e82ef9c9542c5d1ca6ec6a2c3ffe2b16;

// Day 5 circuits
bytes32 internal constant WITHDRAW_COLLATERAL    =
    0x24871915f320a4bc37ff6436424394660768b2176d9e4b32653b6796e1643cdc;
bytes32 internal constant BORROW                 =
    0x08d36912f9bb3b71d0773b5a7058d8c015908324e704553ce607b325cbb32a10;
bytes32 internal constant REPAY                  =
    0x20e23e6c6e062ab49e4c8cb63f3e24d631a22c184b6b24c164b7fef34a609b0b;
bytes32 internal constant LIQUIDATE              =
    0x02970702f859db033e1bfd39a3cccb83febd4cda36b3512554fc7b74483bc914;
bytes32 internal constant CONSOLIDATE_BALANCE    =
    0x1bd0e1573b44b78c835e1f226dbfee8816743117198715875424e0b2ec333f0c;
bytes32 internal constant COMPUTE_TRIGGERS       =
    0x22165dc59931e98ee8cebfee4c559f991812cfd2802db553fe0e6c4a15b4e1f3;
```

### 2. Redeploy ZkVerifier

```bash
cd code/contracts
forge script script/deploy/horizen/ZkVerifier.s.sol:DeployZkVerifier \
  --rpc-url horizen \
  --broadcast \
  --verify
```

### 3. Test Live Proof Submission 🎯

After contracts are redeployed:

1. Start stack: `npm run dev` (dapp), `npm run dev` (data-api)
2. Navigate to Supply page
3. Supply 100 USDC
4. **Expected result:**
   - Browser generates proof with `keccakZK: true` ✅
   - data-api submits to Kurier with 1888-byte VK ✅
   - Kurier returns `status=Aggregated` (NOT `Failed`!) ✅
   - zkVerify publishes to Horizen testnet
   - Pool contract emits `ProofConsumed` event ✅
   - **Phase 2 COMPLETE!** 🎉

---

## Bonus: Vela TEE Validated

Horizen engineer Michael "Clive" confirmed:

> "Their approach is totally feasible... I think the 400 to 800MB memory they are worried about is not a problem for Vela at all. Nitro can be scaled up manually... up to 16 vCPUs and 64GB of memory... You can load barretenberg.wasm directly into Vela's WASM executor... So overall, their approach is completely feasible. They can go ahead and try it with confidence."

**This means:** Once Phase 2 is complete, we can immediately start implementing server-side TEE proving using the spec in `docs/VELA_PROVING_INTEGRATION.md`.

---

## Timeline

- **Today (2026-08-19):** VK format fix committed ✅
- **Next:** Update VkRegistry.sol + redeploy (30 min)
- **Then:** Test live proof submission → Phase 2 complete! 🚀

---

**Status:** Code ready, contracts need redeployment, then we test the full zkVerify flow!
