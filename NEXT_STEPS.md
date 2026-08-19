# NoctFinance — Current Status & Next Steps

**Last Updated:** 2026-08-19  
**Project:** Privacy lending protocol on Horizen testnet  
**Phase:** Phase 2 completion

---

## ✅ VK Format Issue — RESOLVED

### What Was Fixed (2026-08-19)

The Kurier VK format mismatch has been **completely resolved**:

1. ✅ **Root cause identified:** zkVerify requires Keccak oracle hash format (1888-byte VKs), not Poseidon2 (3680-byte VKs)
2. ✅ **Browser prover fixed:** Added `keccakZK: true` to `worker.ts:107`
3. ✅ **VK derivation fixed:** Updated `derive-vks.mjs` to use `oracleHashType: "keccak"`
4. ✅ **All 11 VKs re-derived:** Each circuit now has 1888-byte Keccak VK
5. ✅ **All 11 VKs re-registered:** Kurier accepted all new VK hashes
6. ✅ **Kurier VK hashes updated:** `kurier-vk-hashes.ts` has all new hashes

### Technical Details

**Before (broken):**
```javascript
// worker.ts
const { proof: proofBytes, publicInputs } = await backend.generateProof(witness, {});
// ❌ Defaulted to Poseidon2, generated 3680-byte VKs

// derive-vks.mjs
const PROOF_SETTINGS = {
  oracleHashType: "poseidon2",  // ❌ Wrong for zkVerify
};
```

**After (fixed):**
```javascript
// worker.ts
const { proof: proofBytes, publicInputs } = await backend.generateProof(witness, { keccakZK: true });
// ✅ Explicitly uses Keccak, generates 1888-byte VKs

// derive-vks.mjs
const PROOF_SETTINGS = {
  oracleHashType: "keccak",  // ✅ Correct for zkVerify
};
```

---

## 🔄 Current Status: Pending Redeployment

### What's Done
- Browser proves with correct format
- All VKs registered with Kurier
- Backend knows correct VK hashes

### What's Pending

**Task #27: Update VkRegistry and redeploy ZkVerifier**

The on-chain VkRegistry still has old Poseidon2 hashes. Need to:

1. Update `VkRegistry.sol` with new Keccak VK hashes
2. Redeploy ZkVerifier contract on Horizen testnet
3. Update deployment addresses in configs

**Task #18: Test live proof submission**

After redeployment:
1. Generate supply proof in browser
2. Submit to Kurier → verify reaches `Aggregated` status
3. Call `verifyAndConsume` on-chain → verify `ProofConsumed` event
4. Confirm full flow works end-to-end

---

## 📋 Next Steps

### Phase 2 Completion (This Week)

1. **Redeploy contracts** with updated VK hashes
2. **Test supply proof** end-to-end on Horizen testnet
3. **Verify borrow proof** works with new format
4. **Document the fix** in changelog

### Phase 3: Deployment (Next Week)

1. **Deploy backend** to Railway (prover-service + data-api)
2. **Deploy frontend** to Vercel
3. **Set up invite gate** for controlled access
4. **Configure production secrets** (RPC, Kurier API key)

### Phase 4: UX Refinement (Week 3-4)

1. **Rebuild dapp interaction model** - better proof generation UX
2. **Restyle frontend** - professional polish
3. **Add wallet connection** improvements
4. **Implement note management** UI

### Phase 5: QA & Launch Prep (Week 5+)

1. **Full QA pass** on testnet
2. **Create evidence pack** (screen recordings, test results)
3. **Write user documentation** (how to use the protocol)
4. **Prepare for public testnet** announcement

---

## 🎯 Goals

**Primary Goal:** Privacy lending protocol on Horizen testnet  
**Focus Assets:** USDC, ZEN, WETH (testnet versions)  
**Privacy Model:** Commitments + nullifiers + ZK proofs via zkVerify  
**Target Users:** Privacy-conscious DeFi users

**Future Considerations (On Hold):**
- CCN pivot (institutional RWA lending) - deferred until consumer protocol proven
- Vela TEE proving integration - confirmed feasible, implementation Phase 3+
- Mainnet deployment - pending testnet validation + audit

---

## 📊 Technical Stack (Confirmed Working)

| Component | Technology | Status |
|-----------|-----------|--------|
| Circuits | Noir 1.0.0-beta.18 | ✅ 11 circuits compiled |
| Proving System | UltraHonk (Keccak oracle) | ✅ 1888-byte VKs |
| Prover | bb.js 3.0.x | ✅ Browser + Node |
| Verification | zkVerify Kurier API | ✅ All VKs registered |
| Settlement Chain | Horizen testnet (2651420) | ✅ Proxy verified |
| Contracts | Solidity 0.8.x | ✅ 11 contracts, 217/217 tests pass |
| Oracle | Stork | ✅ Integrated |
| Frontend | Next.js | ✅ Demo-grade UI |
| Backend | Fastify 5 + MCP | ✅ Built |

---

## 🚫 What's NOT Current Focus

- ❌ CCN / RWA / institutional pivot
- ❌ Multi-chain deployment (Base, Polygon, etc.)
- ❌ RedStone oracle integration
- ❌ Auditor disclosure circuits
- ❌ Proof-of-Non-Rehypothecation
- ❌ ERC-4337 agent accounts (built but not priority)
- ❌ Mainnet deployment

These are **future directions** documented in `CCN_TECHNICAL_PIVOT.md` but on hold.

---

## 📁 Key Files

**Source of Truth:**
- `GROUND_TRUTH.md` - Canonical project state (updated 2026-08-19)
- This file (`NEXT_STEPS.md`) - Current status + next actions

**Implementation Patterns:**
- `docs/ZENDEX_PATTERNS_ANALYSIS.md` - Production patterns from Zendex
- `docs/LAYRS_PATTERNS_ANALYSIS.md` - Production patterns from Layrs

**Technical Docs:**
- `docs/ARCHITECTURE.md` - System architecture
- `docs/DEPLOYMENTS.md` - Contract addresses + VK hashes
- `GLOSSARY.md` - Technical terminology
- `CHANGELOG.md` - Version history

**Reference Only (Not Current Plan):**
- `design-v2/` - Original design specs (archived)
- `CCN_TECHNICAL_PIVOT.md` - Future institutional direction (on hold)

---

## 🔗 Critical Commits

- **2026-08-19:** VK format fix (Keccak oracle hash)
- **2026-08-03:** Horizen testnet aggregation proof verified
- **2026-07-30:** All contracts deployed + tested

---

**Current blocker:** None  
**Next action:** Redeploy VkRegistry with Keccak VK hashes  
**ETA to Phase 3:** 2-3 days after redeployment + testing
