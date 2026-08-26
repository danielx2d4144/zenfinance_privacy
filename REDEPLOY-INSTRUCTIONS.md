# Steps to Redeploy Contracts with Fixed VK Hashes

## 1. Install Foundry (Required)

Open PowerShell or Git Bash and run:

```bash
# Download and install Foundry
curl -L https://foundry.paradigm.xyz | bash

# Then restart your terminal and run:
foundryup
```

After installation, verify:
```bash
forge --version
```

## 2. Compile Contracts with Fixed VK Hashes

```bash
cd "C:\Users\Hi\Desktop\team idea\code\contracts"
forge build --force
```

This will compile contracts with the corrected Pedersen VK hashes in VkRegistry.sol.

## 3. Set Environment Variables

```bash
export HORIZEN_TESTNET_HTTPS="https://gobi-rpc.horizenlabs.io/ethv1"
source ~/.zenfinance/horizen-deployer.env
```

## 4. Deploy Contracts

```bash
forge script script/DeployHorizenTestnet.s.sol:DeployHorizenTestnet \
  --rpc-url $HORIZEN_TESTNET_HTTPS \
  --broadcast \
  --slow \
  --legacy
```

The `--legacy` flag uses legacy transaction format (no EIP-1559) which Horizen testnet requires.

## 5. After Deployment

The deployment will output new contract addresses. You need to:

1. **Update deployment manifest**:
   - Save output to `deployments/horizen-testnet-2651420.json`
   
2. **Update dapp configuration**:
   - Copy new addresses to dapp's environment/config

3. **Seed Oracle** (via admin UI at localhost:3000/admin):
   - USDC: $1.00
   - cbBTC: $60,000

4. **Initialize Rate Models** (if needed):
   ```bash
   forge script script/InitializeRateModelV1_2.s.sol:InitializeRateModelV1_2 \
     --rpc-url $HORIZEN_TESTNET_HTTPS \
     --broadcast
   ```

5. **Test the flow**:
   - Deposit → wait for confirmation
   - Supply → should now succeed!

## Why This Is Needed

The deployed contracts have **Kurier VK hashes** instead of **Pedersen VK hashes**.

- Kurier hash for supply_asset: `0x6d827ab8...` (what's deployed)
- Pedersen hash for supply_asset: `0x25acc035...` (what's needed)

The on-chain verifier uses Pedersen hashes, so it rejects all proofs with error `AggregationVerifyFailed()`.

## Alternative: Quick Test Without Redeploy

If you just want to verify the fix works locally, you could:
1. Deploy to a local Anvil testnet
2. Test the complete flow there
3. Then deploy to Horizen testnet when ready

Let me know if you want me to set up local testing instead!
