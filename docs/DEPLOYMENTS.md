# NoctFinance Contract Deployments

**Last Updated:** 2026-08-19  
**Deployment Block:** 25567620  
**Deployment Commit:** (VK format fix - Keccak hashes)

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
| **ZkVerifier** | `0x9FA34fCe202E311dc6c8E73244E365AEeF39cc94` | 🟡 | zkVerify proof verification |
| **PrivacyEntry** | `0x00735D96EDdE1707e2E7fe612B628B8B551F14c8` | 🟡 | Deposit/withdraw with commitments |

### Lending Pools

| Contract | Address | Verified | Description |
|----------|---------|----------|-------------|
| **ShieldedSupplyPool** | `0xC64465c6a00C9F12895Ab3a8fD151324686D3dCF` | 🟡 | Supply/withdraw operations |
| **ShieldedPositionPool** | `0x1539dB2620DB347A41fdd6a7f0d293bBDa9Bc919` | 🟡 | Borrow/repay/collateral |
| **LiquidationBoard** | `0x7Fb0c4305edd6E1fd0E158Abb64D6d824Fe26078` | 🟡 | Liquidation engine |
| **InsuranceFund** | `0x7C3fe8b0de8D085F8f2b8bf5532F805666689C95` | 🟡 | Protocol insurance reserve |

### Configuration

| Contract | Address | Verified | Description |
|----------|---------|----------|-------------|
| **AssetRegistry** | `0x2Cd17ab848BcFddEb3EDbc99208777a6F03edda3` | 🟡 | Asset configuration |
| **RateModel** | `0xeD652bD8347CdFb273abb132B06725cE8D9D871A` | 🟡 | Interest rate calculator |
| **Oracle** | `0xe5cd6Ceea10baF0F3961b8e9B4AFd6acE3C03dAf` | 🟡 | Price feed adapter |

### Test Assets (Testnet Only)

| Token | Address | Description |
|-------|---------|-------------|
| **USDC (Mock)** | `0x9D741b4aECBE3a5514a9b2cCC6bbA0Dc1C8169c0` | Testnet USDC (tUSDC) |
| **cbBTC (Mock)** | `0xA181FF659A40697480F27B7dAe151bF3dA05794A` | Testnet cbBTC (tcbBTC) |

---

## Circuit VK Hashes (Keccak Format)

**VK Format:** 1888-byte Keccak oracle hash (required by zkVerify UltraHonk V3_0)  
**Generated:** 2026-08-19 via `code/dapp/scripts/derive-vks.mjs`

| Circuit ID | Circuit Name | Keccak VK Hash |
|-----------|--------------|----------------|
| 0 | `entry_deposit` | `0x0063b1d06d07c6c2f95c85450bf47e324fd92901fa0009ecf1193a80ea8a4270` |
| 1 | `entry_withdraw` | `0x7f23d01f0f374830c798db6f83f5bd016468d036437628ddfc762f8b513a823c` |
| 2 | `supply_asset` | `0x6d827ab8e9cda14748279168d08e083b72fa7469e8fe83226e5ccf77118be373` |
| 3 | `withdraw_supply` | `0xd6f1bb92d97aa596b227aa556f0b4010761c6ee55780b27c1397c5927497efc2` |
| 4 | `deposit_collateral` | `0xb14b868cd59033bc935723bd1b427c1128df838a180a6be878f9a5da08346704` |
| 5 | `withdraw_collateral` | `0x28499c36b7cf01004d99578626afbbc9843b88a0e829f8c540830f5ef96c4c8a` |
| 6 | `borrow` | `0xd8683cd6f52f93cb0ca080b964e29c9b83048fdbdbe4488c2546ce540b5f7568` |
| 7 | `repay` | `0xca9cd26328f61b020accacbbba348bf8d783dc78e9d6eba54ed007d6535e50b4` |
| 8 | `liquidate` | `0xac31cdb92f463d7958513b4fd52b688c4444ef631a6ef75614d9bad6619f27db` |
| 9 | `consolidate_balance` | `0xf45292467c13d34aeb8654e23bb2e8976954aedfc8d1c82395a5feb4b1480a48` |
| 10 | `compute_triggers` | `0x26f19d4f331dd3905d3eda2b9254ca4da3252cb8fad7d170fe5cd5a4bc1c2bb7` |

**Note:** These are the updated Keccak format VK hashes (1888 bytes). They match the Kurier-registered VKs and are now pinned in `VkRegistry.sol`. Contracts need redeployment for these hashes to take effect on-chain.

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
cast call 0x9FA34fCe202E311dc6c8E73244E365AEeF39cc94 \
  "getVkHash(uint8)(bytes32)" \
  2 \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz

# Expected for supply_asset (ID 2):
# 0x6d827ab8e9cda14748279168d08e083b72fa7469e8fe83226e5ccf77118be373
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

### 2026-08-19: VK Format Update & Redeployment ✅
- **Deployment Block:** 25567620
- **Change:** Redeployed all contracts with Keccak VK format (1888 bytes)
- **Reason:** zkVerify UltraHonk V3_0 pallet requires Keccak format, not Poseidon2 (3680 bytes)
- **Impact:** All VKs re-derived, re-registered with Kurier, and contracts redeployed
- **Gas Used:** 32,729,500 (0.000032737 ZEN)
- **Status:** ✅ Deployment successful, pending verification

### 2026-08-03: Initial Testnet Deployment
- **Commit:** 399cbac
- **Network:** Horizen Testnet (chain ID 2651420)
- **Status:** Initial deployment (superseded by 2026-08-19 redeployment)

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
cast send 0x9D741b4aECBE3a5514a9b2cCC6bbA0Dc1C8169c0 \
  "mint(address,uint256)" \
  <YOUR_ADDRESS> \
  1000000000 \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz \
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
