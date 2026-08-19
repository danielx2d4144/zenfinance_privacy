# Kurier VK Size Mismatch Issue

## Problem Summary
We're unable to register UltraHonk verification keys with Kurier because of a VK size mismatch between what modern bb.js produces and what the zkVerify Substrate pallet accepts.

## Technical Details

**Our Setup:**
- Circuit: Noir 1.0.0-beta.18 (compiled with nargo)
- Prover: `@aztec/bb.js 3.0.0-rc.6` (browser-based proving)
- Target: Kurier REST API → zkVerify Volta testnet → Horizen testnet

**The Mismatch:**
- **bb.js 3.0.x generates:** 3680-byte UltraHonk VKs
- **Kurier V3_0 pallet expects:** 1888-byte VKs (fixed-size array `[u8;1888]` in Substrate)

**Tested Versions (all produce 3680-byte VKs):**
- `@aztec/bb.js@3.0.0-rc.6` → 3680 bytes
- `@aztec/bb.js@3.0.1` (stable) → 3680 bytes  
- `@aztec/bb.js@3.0.3` (stable) → 3680 bytes

**Error When Attempting Registration:**
```
KurierError: register-vk: Verification Key Registration Failed: 
createType(Call):: Call: failed decoding settlementUltrahonkPallet.registerVk:: 
Struct: failed on vk: {"_enum":{"V0_84":"[u8;1760]","V3_0":"[u8;1888]","Legacy":"[u8;1760]"}}:: 
Enum(V3_0):: Expected input with 1888 bytes (15104 bits), found 3680 bytes
```

## Impact
We cannot complete Phase 2 of our testnet deployment (getting a real supply proof through the full Kurier → zkVerify → on-chain pipeline). The entry_deposit flow worked in mock mode, but real Kurier submissions fail at the VK registration step.

## Questions for Horizen/zkVerify Team

1. **Is there a plan to update the V3_0 pallet** to support 3680-byte VKs from bb.js 3.0.x?
2. **Is there a newer version enum** (V3_1? V4_0?) that supports the larger VK format?
3. **What exact bb.js version** should be used with the current V3_0 pallet to generate 1888-byte VKs?
4. **Timeline:** When can we expect support for bb.js 3.0.x VK format?

## Workarounds Considered

1. **Downgrade to bb.js 0.84.0** — but this uses UltraPlonk, not UltraHonk, and requires recompiling all circuits
2. **Wait for pallet update** — blocks our Phase 2 launch
3. **Find intermediate bb.js version** — we haven't found one between 0.84 and 3.0 that generates 1888-byte UltraHonk VKs

## References
- zkVerify UltraHonk docs: https://docs.zkverify.io/architecture/verification_pallets/ultrahonk
- Our derive-vks script: `code/dapp/scripts/derive-vks.mjs`
- Kurier client: `code/backend/prover-service/src/kurier/client.ts`

## Contact
Project: NoctFinance (privacy-preserving lending on Horizen testnet)  
Applying for: Horizen Accelerator Program  
Need: Resolution to unblock Phase 2 testnet deployment

---
Generated: 2026-08-15
