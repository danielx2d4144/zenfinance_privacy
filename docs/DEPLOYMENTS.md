# NoctFinance Contract Deployments

**Last Updated:** 2026-08-19  
**Deployment Commit:** cc203a5 (VK format fix)

---

## Horizen Testnet

| Network | Chain ID | RPC URL | Explorer |
|---------|----------|---------|----------|
| Horizen Testnet | 2651420 | https://gobi-rpc.horizenlabs.io/ethv1 | https://horizen.calderaexplorer.xyz |

**Status:** 🟢 Active testnet deployment

> ⚠️ **Testnet Notice:** These addresses are for testing only. Contract addresses and parameters will change before mainnet launch. Do not use real funds.

---

## Core Contracts

### Privacy Layer

| Contract | Address | Verified | Description |
|----------|---------|----------|-------------|
| **ZkVerifier** | `0xb30323cabcbc75cb4f789232c4dad3793f2a8aa5` | ✅ | zkVerify proof verification |
| **PrivacyEntry** | `0xaff6608e440799c669145997fc230d51404a5142` | ✅ | Deposit/withdraw with commitments |

### Lending Pools

| Contract | Address | Verified | Description |
|----------|---------|----------|-------------|
| **ShieldedSupplyPool** | `0x43c5ba0b57b5fb99b09f34de89825335d82681f1` | ✅ | Supply/withdraw operations |
| **ShieldedPositionPool** | `0x2433d5ef60b0444a2830636e754417ea76c7fe87` | ✅ | Borrow/repay/collateral |
| **LiquidationBoard** | `0xbb58b1457f6c486873fc85c42ed1380df475eff2` | ✅ | Liquidation engine |
| **InsuranceFund** | `0xb53bfef209acfd6ae533b6aa72663bcf0e2861e0` | ✅ | Protocol insurance reserve |

### Configuration

| Contract | Address | Verified | Description |
|----------|---------|----------|-------------|
| **AssetRegistry** | `0x0d6097e8e5804cd540d317b9a633aab925d782a6` | ✅ | Asset configuration |
| **RateModel** | `0x32db36d6fedf7a1d4d0317c0aad3b08b03eb8297` | ✅ | Interest rate calculator |
| **Oracle** | `0x852da28c9bc35870eb01e2d49296b8c1e3204024` | ✅ | Price feed adapter |

### Test Assets (Testnet Only)

| Token | Address | Description |
|-------|---------|-------------|
| **USDC (Mock)** | `0xebb4b50494bfa79ff0b33ea927000ac48b0c2fa1` | Testnet USDC |
| **WETH (Mock)** | `0xc7845af9a8262323602e7b6471ab600cc4ce4d95` | Testnet WETH |

---

## Circuit VK Hashes (Keccak Format)

**VK Format:** 1888-byte Keccak oracle hash (required by zkVerify UltraHonk V3_0)  
**Generated:** 2026-08-19 via `code/dapp/scripts/derive-vks.mjs`

| Circuit ID | Circuit Name | Keccak VK Hash |
|-----------|--------------|----------------|
| 0 | `entry_deposit` | `0x2cb1a74389c8e9874bc7afb547715f84294b5b9ad4afda62f673f0d7723914d3` |
| 1 | `entry_withdraw` | `0x1feea9cbba20ac77c4a57ce109b9f469ca66f28f9589336f5c374f5de1cb72f7` |
| 2 | `supply_asset` | `0x25acc035ddd29df9141476091055fe4928d50e836c07ea723b4b8c02fbe7f7c6` |
| 3 | `withdraw_supply` | `0x18959383b7a911cc6a75759adcf9d3639ec3f9e5009438ae636c40718366889c` |
| 4 | `deposit_collateral` | `0x2f711a9ef305f88bf6f01c2110430f47e82ef9c9542c5d1ca6ec6a2c3ffe2b16` |
| 5 | `withdraw_collateral` | `0x24871915f320a4bc37ff6436424394660768b2176d9e4b32653b6796e1643cdc` |
| 6 | `borrow` | `0x08d36912f9bb3b71d0773b5a7058d8c015908324e704553ce607b325cbb32a10` |
| 7 | `repay` | `0x20e23e6c6e062ab49e4c8cb63f3e24d631a22c184b6b24c164b7fef34a609b0b` |
| 8 | `liquidate` | `0x02970702f859db033e1bfd39a3cccb83febd4cda36b3512554fc7b74483bc914` |
| 9 | `consolidate_balance` | `0x1bd0e1573b44b78c835e1f226dbfee8816743117198715875424e0b2ec333f0c` |
| 10 | `compute_triggers` | `0x22165dc59931e98ee8cebfee4c559f991812cfd2802db553fe0e6c4a15b4e1f3` |

**Note:** These hashes are pinned in `VkRegistry.sol` and must match the VKs registered with Kurier.

---

## Kurier VK Hashes (zkVerify Substrate)

**Kurier API:** https://kurier-api.zkverify.io  
**Registered:** 2026-08-19 via `code/backend/prover-service/scripts/register-all-vks.ts`

| Circuit Name | Kurier VK Hash |
|--------------|----------------|
| `entry_deposit` | `0x0063b1d06d07c6c2f95c85450bf47e324fd92901fa0009ecf1193a80ea8a4270` |
| `entry_withdraw` | `0x7f23d01f0f374830c798db6f83f5bd016468d036437628ddfc762f8b513a823c` |
| `supply_asset` | `0x6d827ab8e9cda14748279168d08e083b72fa7469e8fe83226e5ccf77118be373` |
| `withdraw_supply` | `0xd6f1bb92d97aa596b227aa556f0b4010761c6ee55780b27c1397c5927497efc2` |
| `deposit_collateral` | `0xb14b868cd59033bc935723bd1b427c1128df838a180a6be878f9a5da08346704` |
| `withdraw_collateral` | `0x28499c36b7cf01004d99578626afbbc9843b88a0e829f8c540830f5ef96c4c8a` |
| `borrow` | `0xd8683cd6f52f93cb0ca080b964e29c9b83048fdbdbe4488c2546ce540b5f7568` |
| `repay` | `0xca9cd26328f61b020accacbbba348bf8d783dc78e9d6eba54ed007d6535e50b4` |
| `liquidate` | `0xac31cdb92f463d7958513b4fd52b688c4444ef631a6ef75614d9bad6619f27db` |
| `consolidate_balance` | `0xf45292467c13d34aeb8654e23bb2e8976954aedfc8d1c82395a5feb4b1480a48` |
| `compute_triggers` | `0x26f19d4f331dd3905d3eda2b9254ca4da3252cb8fad7d170fe5cd5a4bc1c2bb7` |

**Note:** Kurier VK hashes differ from on-chain VK hashes — Kurier uses Substrate's blake2-style hashing, while on-chain uses Keccak-256.

---

## Verification

### Verify Contract on Explorer

Visit the contract on [Horizen Explorer](https://horizen.calderaexplorer.xyz) and check:
- ✅ Contract is verified (source code visible)
- ✅ Constructor arguments match deployment
- ✅ Proxy implementation points to correct logic contract

Example for ZkVerifier:
```
https://horizen.calderaexplorer.xyz/address/0xb30323cabcbc75cb4f789232c4dad3793f2a8aa5?tab=contract
```

### Verify VK Hash On-Chain

Check that a circuit's VK hash matches what's registered:

```bash
cast call 0xb30323cabcbc75cb4f789232c4dad3793f2a8aa5 \
  "getVkHash(uint8)(bytes32)" \
  2 \
  --rpc-url https://gobi-rpc.horizenlabs.io/ethv1

# Expected for supply_asset (ID 2):
# 0x25acc035ddd29df9141476091055fe4928d50e836c07ea723b4b8c02fbe7f7c6
```

### Verify Kurier Registration

Check that a VK is registered with Kurier:

```bash
curl -X POST https://kurier-api.zkverify.io/v1/proof/ultrahonk \
  -H "Content-Type: application/json" \
  -d '{
    "proofType": "ultrahonk",
    "proofOptions": {"variant": "ZK", "version": "V3_0"},
    "vk": "<1888-byte-hex-vk>",
    "proof": "<proof-hex>",
    "publicInputs": ["<input1>", "<input2>"]
  }'

# If VK is already registered, Kurier returns existing vkHash
```

---

## Deployment History

### 2026-08-19: VK Format Update
- **Commit:** cc203a5
- **Change:** Switched from Poseidon2 (3680 bytes) to Keccak (1888 bytes) VK format
- **Reason:** zkVerify UltraHonk V3_0 pallet requires Keccak format
- **Impact:** All VKs re-derived and re-registered with Kurier
- **Contracts:** VkRegistry.sol documentation updated

### 2026-08-03: Initial Testnet Deployment
- **Commit:** 399cbac
- **Network:** Horizen Testnet (chain ID 2651420)
- **Status:** Full stack deployed (contracts + circuits + dapp)

---

## Migration Guide

### If Contracts Are Redeployed

1. **Update frontend config:**
   ```typescript
   // code/dapp/src/config/contracts.ts
   export const HORIZEN_TESTNET_CONTRACTS = {
     zkVerifier: '0x<new-address>',
     privacyEntry: '0x<new-address>',
     // ...
   };
   ```

2. **Update backend config:**
   ```bash
   # code/backend/data-api/.env
   HORIZEN_ZK_VERIFIER=0x<new-address>
   HORIZEN_PRIVACY_ENTRY=0x<new-address>
   ```

3. **Re-register VKs:**
   ```bash
   cd code/backend/prover-service
   npm run register-vks
   ```

4. **Update this file** with new addresses and commit.

---

## Network Configuration

### Add Horizen Testnet to MetaMask

| Field | Value |
|-------|-------|
| Network Name | Horizen Testnet |
| RPC URL | https://gobi-rpc.horizenlabs.io/ethv1 |
| Chain ID | 2651420 |
| Currency Symbol | ZEN |
| Block Explorer | https://horizen.calderaexplorer.xyz |

### Get Testnet Tokens

- **ZEN Faucet:** https://faucet.horizen.io/
- **USDC/WETH:** Use mock token contracts (mint function available)

```bash
# Mint 1000 testnet USDC to your address
cast send 0xebb4b50494bfa79ff0b33ea927000ac48b0c2fa1 \
  "mint(address,uint256)" \
  <YOUR_ADDRESS> \
  1000000000 \
  --rpc-url https://gobi-rpc.horizenlabs.io/ethv1 \
  --private-key <YOUR_KEY>
```

---

## Related Documentation

- [Architecture Overview](ARCHITECTURE.md) — system design
- [Privacy Guarantees](PRIVACY.md) — what's private, what's not
- [Circuit Specifications](CIRCUITS.md) — ZK circuit details
- [Developer Guide](DEVELOPER_GUIDE.md) — setup and testing

---

**Questions?** Open a GitHub issue or join our Discord.
