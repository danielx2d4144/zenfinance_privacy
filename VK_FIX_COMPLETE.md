# RESOLVED: VK Format Issue (Keccak vs Poseidon2)

**Date:** 2026-08-19  
**Status:** ✅ **FIXED** — Ready to test live proof submission

---

## Problem

Kurier was rejecting all proof submissions with `status=Failed` before aggregation started. 

**Root cause:** We were generating **Poseidon2 VKs** (3680 bytes, for recursion) but Kurier needed **Keccak VKs** (1888 bytes, for on-chain verification).

This was NOT a version incompatibility issue — bb.js 3.0.x is fully supported by Kurier V3_0. It was a format mismatch.

---

## Solution

Pass `keccakZK: true` when generating proofs and VKs.

### Changes Made

**1. Updated browser prover worker** (`code/dapp/src/lib/prover/worker.ts:107`)
```typescript
// OLD: generateProof(witness, {})
// NEW:
const { proof: proofBytes, publicInputs } = await backend.generateProof(witness, { keccakZK: true });
```

**2. Updated VK derivation script** (`code/dapp/scripts/derive-vks.mjs`)
```javascript
// Changed PROOF_SETTINGS:
const PROOF_SETTINGS = {
  ipaAccumulation: false,
  oracleHashType: "keccak",  // was "poseidon2"
  disableZk: false,
  optimizedSolidityVerifier: false,
};
```

**3. Regenerated all 11 VKs**
```bash
cd code/dapp
node scripts/derive-vks.mjs
```
Result: All VKs now **1888 bytes** (Keccak format) ✅

**4. Re-registered VKs with Kurier**
```bash
cd code/backend/prover-service
npm run register-vks
```
Result: All 11 circuits registered successfully ✅

**5. Updated Kurier VK hashes** (`code/backend/prover-service/src/circuits/kurier-vk-hashes.ts`)

New Kurier hashes:
```typescript
entry_deposit:       "0x0063b1d06d07c6c2f95c85450bf47e324fd92901fa0009ecf1193a80ea8a4270"
entry_withdraw:      "0x7f23d01f0f374830c798db6f83f5bd016468d036437628ddfc762f8b513a823c"
supply_asset:        "0x6d827ab8e9cda14748279168d08e083b72fa7469e8fe83226e5ccf77118be373"
withdraw_supply:     "0xd6f1bb92d97aa596b227aa556f0b4010761c6ee55780b27c1397c5927497efc2"
deposit_collateral:  "0xb14b868cd59033bc935723bd1b427c1128df838a180a6be878f9a5da08346704"
withdraw_collateral: "0x28499c36b7cf01004d99578626afbbc9843b88a0e829f8c540830f5ef96c4c8a"
borrow:              "0xd8683cd6f52f93cb0ca080b964e29c9b83048fdbdbe4488c2546ce540b5f7568"
repay:               "0xca9cd26328f61b020accacbbba348bf8d783dc78e9d6eba54ed007d6535e50b4"
liquidate:           "0xac31cdb92f463d7958513b4fd52b688c4444ef631a6ef75614d9bad6619f27db"
consolidate_balance: "0xf45292467c13d34aeb8654e23bb2e8976954aedfc8d1c82395a5feb4b1480a48"
compute_triggers:    "0x26f19d4f331dd3905d3eda2b9254ca4da3252cb8fad7d170fe5cd5a4bc1c2bb7"
```

---

## Next Steps

### 1. Update VkRegistry.sol with Keccak Hashes

The on-chain VK hashes have changed (Keccak != Poseidon2). Update `VkRegistry.sol`:

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

### 2. Redeploy ZkVerifier on Horizen Testnet

```bash
cd code/contracts
forge script script/deploy/horizen/ZkVerifier.s.sol:DeployZkVerifier \
  --rpc-url horizen \
  --broadcast \
  --verify
```

### 3. Update Pool Config with New Verifier Address

After redeployment, update `HORIZEN_ZK_VERIFIER` in the pool deployment script and redeploy the pool (or update via governance if already deployed).

### 4. Test Live Proof Submission

Once contracts are updated:

1. Start the dapp: `cd code/dapp && npm run dev`
2. Start data-api: `cd code/backend/data-api && npm run dev`
3. Navigate to Supply page
4. Supply 100 USDC
5. Watch the transaction flow:
   - Browser generates proof with `keccakZK: true` ✅
   - Proof submitted to data-api
   - data-api submits to Kurier with 1888-byte Keccak VK ✅
   - **Expected result:** `status=Aggregated` (not `Failed`!)
   - zkVerify publishes to Horizen
   - Pool contract gets `ProofConsumed` event ✅

---

## Credit

**Huge thanks to the Horizen team** (Michael "Clive" and team) for:
1. Confirming bb.js 3.0.x is fully supported (docs not yet updated)
2. Explaining the Keccak vs Poseidon2 format requirement
3. Providing the exact fix: `keccakZK: true`
4. Confirming Vela TEE proving is completely feasible

---

## Related Documents

- `BB_JS_DOWNGRADE_FINDINGS.md` — version compatibility investigation (turned out to be unnecessary)
- `Fixing the VK Registration Issue (UltraHonk, 1888 vs 3680 bytes).md` — Horizen's official fix guide
- `VELA_PROVING_INTEGRATION.md` — server-side proving plan (now validated as feasible)

---

**Status:** Code changes complete, ready for contract redeployment and live testing.
