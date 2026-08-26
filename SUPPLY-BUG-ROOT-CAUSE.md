# Supply Flow Bug - Root Cause Analysis

## Error
```
Error: Kurier job ended in failed (status=Failed)
ContractFunctionExecutionError: The contract function "supplyAsset" reverted with signature: 0x79993b73
```

## Root Cause
The error signature `0x79993b73` corresponds to `AggregationVerifyFailed()` from ZkVerifier.sol.

The on-chain verifier is rejecting zkVerify-aggregated proofs because **the wrong VK hashes were deployed**.

## The Problem

There are TWO different VK hash formats:

1. **Kurier VK hashes** - Used by Kurier aggregation service to identify circuits
   - Example for supply_asset: `0x6d827ab8e9cda14748279168d08e083b72fa7469e8fe83226e5ccf77118be373`
   - Stored in: `backend/prover-service/src/circuits/kurier-vk-hashes.ts`

2. **Pedersen VK hashes** - Used by on-chain verifier to validate proofs
   - Example for supply_asset: `0x25acc035ddd29df9141476091055fe4928d50e836c07ea723b4b8c02fbe7f7c6`
   - Stored in: `circuits/*/target/vk_hash` (binary files)

## What Went Wrong

`VkRegistry.sol` was incorrectly populated with **Kurier VK hashes** instead of **Pedersen VK hashes**.

From VkRegistry.sol line 22 (BEFORE fix):
```solidity
// Updated 2026-08-19: Keccak format VK hashes (1888 bytes)
// These match the Kurier-registered VKs in kurier-vk-hashes.ts  ❌ WRONG!

bytes32 internal constant SUPPLY_ASSET =
    0x6d827ab8e9cda14748279168d08e083b72fa7469e8fe83226e5ccf77118be373;  // Kurier hash
```

Should have been:
```solidity
bytes32 internal constant SUPPLY_ASSET =
    0x25acc035ddd29df9141476091055fe4928d50e836c07ea723b4b8c02fbe7f7c6;  // Pedersen hash
```

## The Flow That Failed

1. ✅ Browser generates proof using correct circuit
2. ✅ Proof submitted to Kurier with Kurier VK hash `0x6d827ab8...`
3. ✅ Kurier aggregates and forwards to zkVerify
4. ✅ zkVerify aggregates successfully
5. ❌ On-chain verification FAILS because:
   - ZkVerifier expects Pedersen hash `0x25acc035...`
   - But was deployed with Kurier hash `0x6d827ab8...`
   - Hash mismatch → `AggregationVerifyFailed()`

## The Fix

Updated `VkRegistry.sol` with correct Pedersen VK hashes from circuit artifacts:

```solidity
// Updated 2026-08-22: Pedersen VK hashes from circuit artifacts
// These are the on-chain verification key hashes (NOT the Kurier hashes)

bytes32 internal constant ENTRY_DEPOSIT = 0x2cb1a74389c8e9874bc7afb547715f84294b5b9ad4afda62f673f0d7723914d3;
bytes32 internal constant ENTRY_WITHDRAW = 0x1feea9cbba20ac77c4a57ce109b9f469ca66f28f9589336f5c374f5de1cb72f7;
bytes32 internal constant SUPPLY_ASSET = 0x25acc035ddd29df9141476091055fe4928d50e836c07ea723b4b8c02fbe7f7c6;
bytes32 internal constant WITHDRAW_SUPPLY = 0x18959383b7a911cc6a75759adcf9d3639ec3f9e5009438ae636c40718366889c;
bytes32 internal constant DEPOSIT_COLLATERAL = 0x2f711a9ef305f88bf6f01c2110430f47e82ef9c9542c5d1ca6ec6a2c3ffe2b16;
bytes32 internal constant WITHDRAW_COLLATERAL = 0x24871915f320a4bc37ff6436424394660768b2176d9e4b32653b6796e1643cdc;
bytes32 internal constant BORROW = 0x08d36912f9bb3b71d0773b5a7058d8c015908324e704553ce607b325cbb32a10;
bytes32 internal constant REPAY = 0x20e23e6c6e062ab49e4c8cb63f3e24d631a22c184b6b24c164b7fef34a609b0b;
bytes32 internal constant LIQUIDATE = 0x02970702f859db033e1bfd39a3cccb83febd4cda36b3512554fc7b74483bc914;
bytes32 internal constant CONSOLIDATE_BALANCE = 0x1bd0e1573b44b78c835e1f226dbfee8816743117198715875424e0b2ec333f0c;
bytes32 internal constant COMPUTE_TRIGGERS = 0x22165dc59931e98ee8cebfee4c559f991812cfd2802db553fe0e6c4a15b4e1f3;
```

## Next Steps

**FULL STACK REDEPLOY REQUIRED** because:
- Pool contracts (ShieldedSupplyPool, ShieldedPositionPool, PrivacyEntry) have `immutable` verifier addresses
- Cannot update the verifier address without redeploying the pools
- Must redeploy entire lending stack with corrected VkRegistry

### Deployment Command:
```bash
cd code/contracts
source ~/.zenfinance/horizen-deployer.env
forge script script/DeployHorizenTestnet.s.sol:DeployHorizenTestnet \
  --rpc-url $HORIZEN_TESTNET_HTTPS --broadcast --slow
```

### After Deployment:
1. Update `code/contracts/deployments/horizen-testnet-2651420.json` with new addresses
2. Seed oracle with asset prices (USDC, cbBTC)
3. Initialize rate models
4. Test deposit → supply flow end-to-end

## Files Changed
- `code/contracts/src/libraries/VkRegistry.sol` - Fixed VK hashes
- `code/contracts/script/RedeployZkVerifier.s.sol` - Created (but full redeploy needed)

## Other Fixes Made During Investigation
1. Fixed IMT state persistence in `code/dapp/src/hooks/useSpendingKey.tsx`
   - Added `imtVersion` counter to force context re-memoization after IMT hydration
2. Rebuilt prover-service to clear VK hash drift
3. Registered VKs with Kurier via `npm run register-vks`
