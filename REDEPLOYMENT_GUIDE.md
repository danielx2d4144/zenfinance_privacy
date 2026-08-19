# Redeployment Guide — VK Hash Update

**Date:** 2026-08-19  
**Reason:** Update VkRegistry with Keccak format VK hashes  
**Impact:** All contracts must be redeployed due to VkRegistry change

---

## What Changed

VkRegistry.sol now contains the correct Keccak format VK hashes (1888 bytes) that match what Kurier expects. The old Poseidon2 hashes (3680 bytes) have been replaced.

**Files Updated:**
- ✅ `code/contracts/src/libraries/VkRegistry.sol` - Updated with Keccak VK hashes
- ✅ `code/dapp/src/lib/prover/worker.ts` - Added `keccakZK: true`
- ✅ `code/dapp/scripts/derive-vks.mjs` - Changed to `oracleHashType: "keccak"`
- ✅ `code/backend/prover-service/src/circuits/kurier-vk-hashes.ts` - Already has Keccak hashes
- ✅ All 11 VKs registered with Kurier (2026-08-19)

---

## Prerequisites

Before redeployment, verify:

1. **Deployer wallet has ZEN for gas:**
   ```bash
   cast balance $DEPLOYER_ADDRESS --rpc-url https://gobi-rpc.horizenlabs.io/ethv1
   # Should have > 0.005 ETH (ZEN) for gas
   ```

2. **Private key is set:**
   ```bash
   echo $DEPLOYER_PRIVATE_KEY | wc -c
   # Should output 65 (64 hex chars + newline)
   ```

3. **RPC is accessible:**
   ```bash
   cast chain-id --rpc-url https://gobi-rpc.horizenlabs.io/ethv1
   # Should output: 2651420
   ```

---

## Deployment Steps

### Step 1: Set Environment Variables

```bash
# Set your deployer private key
export DEPLOYER_PRIVATE_KEY=0x<your-private-key-here>

# Optional: override zkVerify proxy (default is correct)
export ZKVERIFY_PROXY=0x3098A6974649478f0133046e44105AA84e868C21

# Store RPC URL for convenience
export HORIZEN_RPC=https://gobi-rpc.horizenlabs.io/ethv1
```

### Step 2: Navigate to Contracts Directory

```bash
cd code/contracts
```

### Step 3: Run Deployment Script

```bash
forge script script/DeployHorizenTestnet.s.sol:DeployHorizenTestnet \
  --rpc-url $HORIZEN_RPC \
  --broadcast \
  --slow \
  --legacy
```

**Flags explained:**
- `--broadcast` - Actually send transactions (remove for dry-run)
- `--slow` - Wait longer between transactions to avoid nonce issues
- `--legacy` - Use legacy transaction format (Horizen testnet requirement)

### Step 4: Save Deployment Addresses

The script will output a JSON file to:
```
code/contracts/deployments/horizen-testnet-2651420.json
```

And print addresses to console:
```
--- ZenFinance on Horizen testnet ---
ZkVerifier          : 0x<new-address>
PrivacyEntry        : 0x<new-address>
ShieldedSupplyPool  : 0x<new-address>
ShieldedPositionPool: 0x<new-address>
LiquidationBoard    : 0x<new-address>
...
```

**Copy these addresses** - you'll need them for the next steps.

---

## Post-Deployment Steps

### Step 1: Update Configuration Files

#### Frontend Config
```bash
# Edit code/dapp/src/config/contracts.ts
# Update all contract addresses with new deployment
```

#### Backend Config
```bash
# Edit code/backend/data-api/.env
HORIZEN_ZK_VERIFIER=0x<new-zkverifier-address>
HORIZEN_PRIVACY_ENTRY=0x<new-privacyentry-address>
HORIZEN_SHIELDED_SUPPLY_POOL=0x<new-shieldedsupplypool-address>
HORIZEN_SHIELDED_POSITION_POOL=0x<new-shieldedpositionpool-address>
HORIZEN_LIQUIDATION_BOARD=0x<new-liquidationboard-address>
# ... update all addresses
```

#### Prover Service Config
```bash
# Edit code/backend/prover-service/.env
HORIZEN_ZK_VERIFIER=0x<new-zkverifier-address>
```

### Step 2: Update DEPLOYMENTS.md

```bash
# Edit docs/DEPLOYMENTS.md
# Replace all old contract addresses with new ones
# Update deployment date and commit hash
```

### Step 3: Verify Contracts on Explorer

For each deployed contract, verify on Horizen Explorer:

```bash
# Example for ZkVerifier
forge verify-contract \
  <ZkVerifier-address> \
  src/ZkVerifier.sol:ZkVerifier \
  --rpc-url $HORIZEN_RPC \
  --etherscan-api-key <not-required-for-horizen> \
  --constructor-args $(cast abi-encode "constructor(address,address,bytes32[])" $ADMIN $ZKVERIFY_PROXY $VK_ARRAY)
```

**Note:** Horizen testnet verification may not work automatically. Manual verification via explorer UI may be needed.

### Step 4: Test VK Hash On-Chain

Verify the new VK hashes are deployed correctly:

```bash
# Check supply_asset VK hash (should match Kurier registration)
cast call <new-zkverifier-address> \
  "getVkHash(uint8)(bytes32)" \
  2 \
  --rpc-url $HORIZEN_RPC

# Expected output:
# 0x6d827ab8e9cda14748279168d08e083b72fa7469e8fe83226e5ccf77118be373
```

Test all 11 circuits (IDs 0-10) to ensure all VK hashes match.

---

## Testing Live Proof Submission

After redeployment, test the full proof flow:

### Step 1: Generate Test Proof

```bash
cd code/dapp
npm run dev
# Open browser, generate a supply proof
```

### Step 2: Submit to Kurier

The frontend will automatically submit to Kurier. Check status:

```bash
# Copy jobId from browser console
curl https://kurier-api.zkverify.io/v1/job/<jobId>
```

Expected status progression:
- `Submitted` (immediate)
- `IncludedInBlock` (5-10s)
- `AggregationPending` (20-30s)
- `Aggregated` (2-3 minutes)

### Step 3: Verify On-Chain

Once status is `Aggregated`, the proof should be consumable on-chain:

```bash
# Call verifyAndConsume from PrivacyEntry or ShieldedSupplyPool
# Should emit ProofConsumed event
```

---

## Rollback Plan

If deployment fails or tests fail:

1. **Keep old contract addresses** in configs
2. **Do not update docs/DEPLOYMENTS.md**
3. **Investigate issue** before retrying
4. **Contact Horizen support** if zkVerify proxy issues

Old deployment addresses are preserved in git history:
```bash
git show HEAD~1:docs/DEPLOYMENTS.md
```

---

## Success Criteria

Deployment is successful when:

- ✅ All 11 contracts deployed without errors
- ✅ VK hashes on-chain match Kurier-registered hashes
- ✅ Test proof reaches `Aggregated` status on Kurier
- ✅ `verifyAndConsume` succeeds on-chain
- ✅ `ProofConsumed` event emitted
- ✅ Frontend can submit proofs successfully

---

## Troubleshooting

### "Insufficient funds" Error
- Check deployer balance: `cast balance $DEPLOYER_ADDRESS --rpc-url $HORIZEN_RPC`
- Get testnet ZEN: https://faucet.horizen.io/

### "Nonce too low" Error
- Add `--slow` flag to deployment command
- Wait 10 seconds between retries

### "zkVerify proxy has no bytecode" Error
- Verify proxy address: `cast code 0x3098A6974649478f0133046e44105AA84e868C21 --rpc-url $HORIZEN_RPC`
- Check you're on correct network (chain ID 2651420)

### VK Hash Mismatch After Deployment
- Verify VkRegistry.sol was compiled with updated hashes
- Check `forge build` output for compilation warnings
- Ensure no cached artifacts: `forge clean && forge build`

---

## Next Steps After Successful Deployment

1. Update all config files with new addresses
2. Commit changes to git
3. Test supply proof end-to-end
4. Test borrow proof end-to-end
5. Move to Phase 3: Railway + Vercel deployment

---

**Ready to deploy?** Run the commands in Step 3 above.
