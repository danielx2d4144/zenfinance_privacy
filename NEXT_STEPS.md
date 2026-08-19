# NoctFinance Phase 2 — Next Steps

## Current Status: BLOCKED on Kurier VK Size Mismatch

### What We Accomplished
✅ Successfully identified root cause of `status=Failed` errors  
✅ Created `derive-vks.mjs` script that generates VKs using bb.js 3.0.x Node.js WASM  
✅ Confirmed all 11 circuits now have 3680-byte VKs (matching browser prover)  
✅ Tested bb.js versions 3.0.0-rc.6, 3.0.1, 3.0.3 — all produce 3680-byte VKs  
✅ Documented the issue with technical details for Horizen support  

### The Problem
**Kurier's Substrate pallet has VK sizes hardcoded:**
- `V3_0`: expects `[u8;1888]` (1888 bytes)
- `V0_84`: expects `[u8;1760]` (1760 bytes)  
- `Legacy`: expects `[u8;1760]` (1760 bytes)

**All modern bb.js 3.0.x versions generate 3680-byte VKs** — which the pallet rejects with:
```
Expected input with 1888 bytes (15104 bits), found 3680 bytes
```

This is a **version mismatch** between bb.js 3.0.x (what we use for browser proving) and what zkVerify's current pallet supports.

---

## Immediate Actions Required

### 1. Contact Horizen/zkVerify Support
**File:** `VK_SIZE_MISMATCH_ISSUE.md` contains full technical details

**Channels:**
- Discord: discord.gg/zkverify
- Email: kurier-support@horizenlabs.io
- GitHub: https://github.com/zkVerify/zkVerify/issues

**Questions to ask:**
1. Is there a plan to update V3_0 or add V4_0 for 3680-byte VKs?
2. What exact bb.js version should we use with current V3_0 (1888-byte)?
3. Timeline for supporting bb.js 3.0.x VK format?

### 2. Interim Workarounds (While Waiting for Support Response)

**Option A: Mock Mode for Demo (Fastest)**
- Set `ATTESTATION_MODE=mock` in data-api `.env`
- Supply/borrow flows will work end-to-end for UI/UX demo
- No real Kurier verification (synthetic receipts only)
- Good for: Horizen Accelerator demo, UI testing
- **Implementation:** 1 line change in `.env`

**Option B: Try bb.js 0.84.0 with UltraPlonk (Complex)**
- Downgrade to `@aztec/bb.js@0.84.0`
- Change proof system from UltraHonk to UltraPlonk
- Recompile all 11 circuits with older nargo
- Update prover worker to use 0.84.0 API (different from 3.0.x)
- **Risk:** May break Noir 1.0.0-beta.18 compatibility
- **Timeline:** 1-2 days minimum

**Option C: Search for Intermediate bb.js Version**
- Look for bb.js 2.x or early 3.0-alpha versions
- Test if any generate 1888-byte UltraHonk VKs
- **Risk:** May not exist or be compatible with our circuits
- **Timeline:** Several hours of trial and error

---

## Recommended Path Forward

1. **TODAY:** Contact Horizen support with `VK_SIZE_MISMATCH_ISSUE.md`
2. **PARALLEL:** Enable mock mode for Accelerator demo preparation
3. **IF URGENT:** Explore Option C (intermediate versions)
4. **WAIT:** For Horizen response before attempting Option B

---

## Technical Artifacts Created

All tools are ready for when Kurier is updated:

1. **`code/dapp/scripts/derive-vks.mjs`**  
   Derives VKs from circuit artifacts using bb.js Node.js WASM  
   Already tested and working with bb.js 3.0.x

2. **Updated VK files (3680 bytes each)**  
   `code/circuits/*/target/vk` — ready for Kurier when pallet is updated

3. **New Poseidon2 VK hashes**  
   Printed by derive-vks.mjs for VkRegistry.sol update (optional)

4. **Test script: `.vktest/test-vk-size.mjs`**  
   Quickly test VK size for any bb.js version

---

## What Happens After Resolution

Once Kurier supports 3680-byte VKs (or we find the right bb.js version):

1. Run `cd code/backend/prover-service && npm run register-vks`
2. Update `kurier-vk-hashes.ts` with new Kurier VK hashes
3. Test supply proof submission → should reach `Aggregated` status
4. Complete Phase 2: Get `ProofConsumed` event on Horizen testnet ZkVerifier
5. Move to Phase 3: Deploy to Railway + Vercel

---

## Files & Context

- **Issue doc:** `VK_SIZE_MISMATCH_ISSUE.md`
- **Derive script:** `code/dapp/scripts/derive-vks.mjs`
- **Test script:** `.vktest/test-vk-size.mjs`
- **Kurier schemas:** `code/backend/prover-service/src/kurier/schemas.ts`
- **VK loader:** `code/backend/prover-service/src/circuits/vk-loader.ts`
- **Register script:** `code/backend/prover-service/scripts/register-all-vks.ts`

**Key insight:** The VK mismatch is NOT a bug in our code — it's a compatibility gap between modern bb.js (3.0.x) and zkVerify's current Substrate pallet implementation.

---

Generated: 2026-08-15
