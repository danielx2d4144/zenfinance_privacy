# NoctFinance Architecture

**Version:** 0.1.0 (Testnet)  
**Last Updated:** 2026-08-19

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Core Problem Solved](#core-problem-solved)
3. [Privacy Model](#privacy-model)
4. [Component Architecture](#component-architecture)
5. [Proof Flow](#proof-flow)
6. [Data Flow](#data-flow)
7. [Smart Contract Architecture](#smart-contract-architecture)
8. [Circuit Architecture](#circuit-architecture)
9. [Security Considerations](#security-considerations)

---

## System Overview

NoctFinance is a privacy-preserving lending protocol built on Horizen using Zero-Knowledge Proofs. It consists of four major components:

```
┌─────────────────────────────────────────────────────────────┐
│                      NoctFinance Stack                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────┐    ┌────────────┐    ┌────────────┐        │
│  │  Frontend  │───▶│  Backend   │───▶│  zkVerify  │───┐    │
│  │  (Browser) │    │  (API)     │    │  (Kurier)  │   │    │
│  └────────────┘    └────────────┘    └────────────┘   │    │
│       │                                                 │    │
│       │ generates proofs                               │    │
│       │ (bb.js WASM)                                   ▼    │
│       │                                          ┌────────┐ │
│       └─────────────────────────────────────────▶ Horizen│ │
│                                                  │Testnet│ │
│                                                  └────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │           Smart Contracts (Solidity)               │    │
│  │  • ZkVerifier  • Pool  • PrivacyEntry             │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │          ZK Circuits (Noir + Barretenberg)         │    │
│  │  • 11 UltraHonk circuits covering full lifecycle   │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**Key Innovation:** Client-side proof generation (browser) + off-chain aggregation (zkVerify) + on-chain verification (Horizen) = privacy + scalability.

---

## Core Problem Solved

| Problem with Public Lending | NoctFinance Solution |
|------------------------------|---------------------|
| **Balances visible on-chain** | Balances hidden in cryptographic commitments |
| **Loan amounts are public** | Amounts encoded in private ZK proofs |
| **Positions can be tracked** | Deposits and withdrawals are cryptographically unlinkable |
| **Liquidations reveal full portfolio** | Liquidations prove insolvency without revealing exact balances |
| **MEV on liquidations** | Privacy reduces MEV opportunities |
| **No recovery mechanism** | Recover all commitments from spending key alone |

**Example:** Alice supplies 1000 USDC and borrows 500 USDC against ZEN collateral. On Aave, everyone sees:
- Alice's wallet address
- Exact supply: 1000 USDC
- Exact borrow: 500 USDC  
- Her health factor: 2.5x
- When she gets liquidated

On NoctFinance, observers see:
- A commitment was created (random-looking hash)
- A nullifier was published (random-looking hash)
- A ZK proof was verified ✅
- **Nothing about Alice, her balances, or her position**

---

## Privacy Model

### Commitments

A **commitment** is a cryptographic seal on private data:

```
commitment = Poseidon2(
  asset_id,      // e.g., USDC = 1
  amount,        // e.g., 1000 * 10^6
  Poseidon2(salt, spending_key)
)
```

**Properties:**
- Cannot be reverse-engineered (preimage resistance)
- Deterministic for same inputs (but salt randomizes)
- Short (32 bytes) and efficient in ZK circuits

**Stored:** On-chain in an Incremental Merkle Tree

### Nullifiers

A **nullifier** prevents double-spending:

```
nullifier = Poseidon2(
  commitment,
  spending_key
)
```

**Properties:**
- Unique per commitment
- Only computable by commitment owner (knows spending key)
- Published once when commitment is spent
- Cannot reveal which commitment it corresponds to

**Stored:** On-chain in a nullifier registry (prevents re-use)

### Merkle Tree

All commitments live in an **Incremental Merkle Tree** (IMT):

```
                    Root
                   /    \
                  /      \
                 /        \
              Node        Node
             /    \      /    \
           Leaf  Leaf  Leaf  Leaf
           (c1)  (c2)  (c3)  (c4)
```

**Properties:**
- Depth: 20 (supports 2^20 = ~1M commitments)
- Hash function: Poseidon2
- Proving a commitment exists requires only 20 sibling hashes (Merkle proof)

**Why this matters:** You can prove "my commitment is in the tree" without revealing which commitment or what others are.

### Unlinkability

**Deposit → Withdraw unlinkability:**

1. Alice deposits 1000 USDC from address `0xABC...`
   - Creates `commitment_A = Poseidon2(USDC, 1000, ...)`
   - Anyone sees: "address 0xABC deposited, commitment_A created"

2. Later, Alice withdraws 1000 USDC to address `0xXYZ...`
   - Publishes `nullifier_A = Poseidon2(commitment_A, key)`
   - Anyone sees: "nullifier_A appeared, address 0xXYZ received 1000 USDC"

3. **No link:** Observers cannot connect `commitment_A` to `nullifier_A` without knowing Alice's spending key.

**Result:** Alice's deposit and withdrawal are cryptographically unlinkable.

---

## Component Architecture

### 1. Frontend (Next.js Dapp)

**Location:** `code/dapp/`  
**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Viem, Wagmi, Tailwind CSS

**Responsibilities:**
- User interface for deposit/supply/borrow/withdraw
- **Client-side ZK proof generation** (bb.js 3.0.0-rc.6 in Web Worker)
- Encrypted note storage (IndexedDB)
- Recovery from spending key
- Transaction signing and broadcasting

**Key files:**
- `src/lib/prover/worker.ts` — Web Worker for proof generation
- `src/lib/prover/witnesses/` — Witness generation for each circuit
- `src/hooks/useSpendingKey.tsx` — Spending key management and recovery
- `src/components/` — UI components

**Proof generation flow:**
```typescript
// In browser (Web Worker)
const witness = buildSupplyWitness({ oldBalance, newBalance, ... });
const { proof, publicInputs } = await backend.generateProof(witness, { keccakZK: true });
// Send to backend for Kurier submission
```

---

### 2. Backend (Fastify APIs)

**Location:** `code/backend/`  
**Tech Stack:** Fastify 5, TypeScript, Postgres, Viem

#### 2a. data-api (Main API)

**Responsibilities:**
- Proof submission to Kurier
- Intent tracking (supply/borrow/repay/liquidate)
- Event indexing from Horizen
- Note encryption/decryption helpers

**Key endpoints:**
- `POST /intents/supply` — Submit supply intent + proof
- `POST /intents/borrow` — Submit borrow intent + proof
- `GET /intents/:id` — Get intent status
- `GET /notes/:commitment` — Get encrypted note

#### 2b. prover-service

**Responsibilities:**
- VK registration with Kurier
- Proof verification helpers (dev/test)

**Key scripts:**
- `scripts/register-all-vks.ts` — Register all 11 VKs with Kurier
- `src/kurier/client.ts` — Kurier API client

---

### 3. ZK Circuits (Noir)

**Location:** `code/circuits/`  
**Tech Stack:** Noir 1.0.0-beta.18, Barretenberg (UltraHonk)

**11 circuits covering full lifecycle:**

| Circuit | Purpose | Key Constraints |
|---------|---------|-----------------|
| `entry_deposit` | Deposit tokens → create commitment | Valid commitment formation |
| `entry_withdraw` | Nullify commitment → withdraw tokens | Ownership proof, nullifier validity |
| `supply_asset` | Supply to lending pool | Balance check, interest accrual |
| `withdraw_supply` | Withdraw from pool | Sufficient balance, no active borrows |
| `deposit_collateral` | Deposit collateral privately | Valid collateral commitment |
| `withdraw_collateral` | Withdraw collateral | Health factor > threshold |
| `borrow` | Borrow against collateral | Sufficient collateral, LTV check |
| `repay` | Repay loan | Debt balance check |
| `liquidate` | Liquidate undercollateralized position | Health factor < 1.0 proof |
| `consolidate_balance` | Merge multiple commitments | Sum preservation |
| `compute_triggers` | Update interest/health factors | Correct arithmetic |

**Compilation:**
```bash
cd code/circuits/<circuit_name>
nargo compile
# Outputs target/<circuit>.json (bytecode + ABI)
```

**VK generation:**
```bash
cd code/dapp
node scripts/derive-vks.mjs
# Generates 1888-byte Keccak VKs for all circuits
```

---

### 4. Smart Contracts (Solidity)

**Location:** `code/contracts/`  
**Tech Stack:** Solidity 0.8.27, Foundry, OpenZeppelin

**Contract tree:**
```
NoctFinance Contracts
│
├── Privacy Layer
│   ├── ZkVerifier              (zkVerify proof verification)
│   ├── VkRegistry              (Circuit VK hashes)
│   ├── PrivacyEntry            (Deposit/withdraw with commitments)
│   ├── CommitmentRegistry      (Merkle tree of commitments)
│   └── NullifierRegistry       (Double-spend prevention)
│
├── Lending Layer
│   ├── ShieldedSupplyPool      (Supply/withdraw operations)
│   ├── ShieldedPositionPool    (Borrow/repay/collateral)
│   ├── LiquidationBoard        (Liquidation engine)
│   └── InsuranceFund           (Protocol reserve)
│
├── Configuration
│   ├── AssetRegistry           (Supported assets + parameters)
│   ├── RateModel               (Interest rate calculation)
│   └── Oracle                  (Chainlink price feeds)
│
└── Test Utilities (Testnet)
    ├── MockERC20               (Testnet USDC/WETH)
    └── TestHelpers             (Test fixtures)
```

**Key interactions:**
1. User calls `PrivacyEntry.deposit()` → creates commitment
2. User calls `ShieldedSupplyPool.supply()` with ZK proof → verifies via ZkVerifier
3. ZkVerifier checks proof against zkVerify attestation
4. Pool updates internal accounting, emits `ProofConsumed` event

---

## Proof Flow

**End-to-end proof journey (Supply example):**

```
┌──────────┐
│ Browser  │
│ (User)   │
└────┬─────┘
     │ 1. Click "Supply 1000 USDC"
     │
     ▼
┌──────────────────────────────┐
│ Frontend (Next.js)           │
│ • Builds witness             │
│ • Calls Web Worker           │
└──────────┬───────────────────┘
           │ 2. Witness data
           ▼
┌──────────────────────────────┐
│ Web Worker (bb.js WASM)      │
│ • Loads circuit bytecode     │
│ • Generates UltraHonk proof  │
│   with keccakZK: true        │
│ • ~5-15s for supply_asset    │
└──────────┬───────────────────┘
           │ 3. Proof + public inputs
           ▼
┌──────────────────────────────┐
│ data-api (Backend)           │
│ • Validates proof format     │
│ • Submits to Kurier REST API │
└──────────┬───────────────────┘
           │ 4. POST /v1/proof/ultrahonk
           ▼
┌──────────────────────────────┐
│ Kurier (zkVerify Relayer)    │
│ • Verifies UltraHonk proof   │
│ • Submits to zkVerify Volta  │
└──────────┬───────────────────┘
           │ 5. Extrinsic to Volta
           ▼
┌──────────────────────────────┐
│ zkVerify (Substrate Chain)   │
│ • Batch verifies proofs      │
│ • Aggregates into Merkle tree│
│ • Posts aggregation to proxy │
└──────────┬───────────────────┘
           │ 6. Aggregation proof
           ▼
┌──────────────────────────────┐
│ Horizen Testnet (EVM)        │
│ ZkVerifier.verifyAndConsume()│
│ • Checks zkVerify attestation│
│ • Emits ProofConsumed event  │
└──────────┬───────────────────┘
           │ 7. Event emitted
           ▼
┌──────────────────────────────┐
│ ShieldedSupplyPool           │
│ • Updates internal state     │
│ • Credits supply balance     │
│ • User's commitment stored   │
└──────────────────────────────┘
```

**Timing:**
- Proof generation: 5-15s (browser, varies by circuit complexity)
- Kurier submission: ~1s
- zkVerify aggregation: ~30-60s (batches multiple proofs)
- On-chain verification: ~10s (Horizen block confirmation)

**Total:** ~1-2 minutes from "click" to "confirmed"

---

## Data Flow

### Information Flow (Privacy Boundaries)

```
┌─────────────────────────────────────────────────────────┐
│                    PRIVATE (Client-Side)                 │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  • Spending key                                          │
│  • Salt values                                           │
│  • Actual balance amounts                                │
│  • Debt amounts                                          │
│  • Health factor                                         │
│  • Transaction amounts                                   │
│                                                          │
│  ┌─────────────────────────────────────────┐           │
│  │  Sealed in ZK Proof (private inputs)     │           │
│  └─────────────────────────────────────────┘           │
│                          │                               │
└──────────────────────────┼───────────────────────────────┘
                           │ Proof generation
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    PUBLIC (On-Chain)                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  • Commitments (32-byte hashes)                          │
│  • Nullifiers (32-byte hashes)                           │
│  • Merkle root                                           │
│  • ZK proof (verified ✅)                               │
│  • Public inputs (asset ID, root, nullifier)            │
│  • Transaction sender address                            │
│  • Block timestamp                                       │
│                                                          │
│  ❌ NOT VISIBLE:                                        │
│     • Balances, amounts, debt, health factor            │
│     • Link between deposit and withdrawal               │
│     • Which commitment belongs to which user            │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Privacy guarantee:** An observer with complete blockchain access cannot determine:
1. How much any user has supplied or borrowed
2. Which deposits correspond to which withdrawals
3. Any user's health factor or liquidation risk

---

## Smart Contract Architecture

### Modularity

Contracts are separated by concern:

**Verification Layer:**
```solidity
ZkVerifier
  ├─ verifyAndConsume(circuitId, vkHash, proof)
  │  └─ checks zkVerify attestation
  │  └─ emits ProofConsumed(circuitId, publicInputs)
  └─ VkRegistry (library)
     └─ returns expected VK hash for circuit
```

**Privacy Layer:**
```solidity
PrivacyEntry
  ├─ deposit(asset, amount) → creates commitment
  ├─ withdraw(proof, asset, amount) → burns nullifier
  └─ CommitmentRegistry
     └─ Merkle tree storage

NullifierRegistry
  └─ prevents nullifier reuse
```

**Lending Layer:**
```solidity
ShieldedSupplyPool
  ├─ supply(proof) → verify → update accounting
  ├─ withdrawSupply(proof)
  └─ relies on ZkVerifier for proof verification

ShieldedPositionPool
  ├─ depositCollateral(proof)
  ├─ withdrawCollateral(proof) → requires health check
  ├─ borrow(proof) → requires LTV check
  └─ repay(proof)

LiquidationBoard
  └─ liquidate(proof) → requires health < 1.0 proof
```

### Upgradeability

**UUPS Pattern:**
- Proxy contract (never changes address)
- Implementation contract (upgradeable)
- Storage stays in proxy
- Users always interact with proxy address

**Upgradeable contracts:**
- ShieldedSupplyPool
- ShieldedPositionPool
- LiquidationBoard

**Non-upgradeable:**
- ZkVerifier (verification logic is immutable)
- PrivacyEntry (commitment/nullifier registries)

---

## Circuit Architecture

### Common Circuit Pattern

All spend circuits follow the same structure:

```noir
// 1. Verify old commitment exists in Merkle tree
let root = merkle_root(old_commitment, siblings, index);
assert(root == expected_root);

// 2. Compute nullifier
let nullifier = poseidon2([old_commitment, spending_key]);

// 3. Create new commitment
let new_commitment = poseidon2([asset_id, new_amount, salt]);

// 4. Verify spending key ownership
assert(old_commitment == poseidon2([
  asset_id, 
  old_amount, 
  poseidon2([old_salt, spending_key])
]));

// 5. Circuit-specific checks (e.g., balance >= amount)
assert(old_amount >= withdraw_amount);

// 6. Output public values
(root, nullifier, new_commitment, asset_id, ...)
```

### Circuit Compilation & Deployment Flow

```
Noir Source (.nr)
     │
     ▼ nargo compile
Circuit Bytecode (.json)
     │
     ▼ bb.js (with keccakZK: true)
Verification Key (1888 bytes)
     │
     ├─▶ Register with Kurier
     │   (get Kurier VK hash)
     │
     └─▶ Compute Keccak-256 hash
         (VK hash for VkRegistry.sol)
```

---

## Security Considerations

### Trust Assumptions

**Cryptographic:**
- Poseidon2 hash is collision-resistant
- UltraHonk proving system is sound
- Keccak-256 is preimage-resistant

**Infrastructure:**
- zkVerify correctly verifies UltraHonk proofs
- Horizen EVM correctly executes smart contracts
- Chainlink oracles provide accurate prices

**Operational:**
- User keeps spending key secure
- Browser WASM runtime is not compromised
- Smart contract admin is trustworthy (pre-governance)

### Threat Model

**In Scope (Mitigated):**
- ✅ Balance privacy — hidden in commitments
- ✅ Transaction unlinkability — nullifiers don't reveal commitments
- ✅ Double-spending — nullifier registry prevents reuse
- ✅ Front-running — privacy reduces MEV opportunities

**Out of Scope (User Responsibility):**
- ❌ Network-level anonymity — use Tor/VPN for IP privacy
- ❌ Browser security — malware can steal spending key
- ❌ Deposit address privacy — on-chain sender is visible
- ❌ Timing analysis — transaction timing is public

### Recovery & Key Management

**Spending Key = Full Control:**
- If you lose your wallet but have your spending key → can recover all commitments
- If you lose your spending key → funds are permanently inaccessible
- Store spending key securely (hardware wallet, paper backup)

**Recovery process:**
```typescript
// Scan blockchain for commitments you own
for (const commitment of allCommitments) {
  const recomputed = poseidon2([
    asset_id,
    amount,
    poseidon2([salt, mySpendingKey])
  ]);
  if (recomputed === commitment) {
    // This commitment is yours!
    saveNote({ commitment, amount, salt });
  }
}
```

---

## Performance & Scalability

### Bottlenecks

**Current:**
1. **Browser proving** — 5-15s per proof (CPU-bound)
2. **zkVerify aggregation** — 30-60s (batching delay)
3. **Merkle tree depth** — 20 levels = 1M max commitments

**Future Optimizations:**
1. **Vela TEE proving** — offload to server (10x faster)
2. **Batch operations** — multiple actions in one proof
3. **Tree sharding** — multiple trees for higher capacity

### Gas Costs

**On-chain operations:**
- Deposit: ~150K gas (commitment insertion)
- Withdraw: ~200K gas (nullifier check + verification)
- Supply/Borrow: ~250K gas (zkVerify verification + state update)

**zkVerify aggregation** reduces per-proof cost by ~10x vs native verification.

---

## Further Reading

- [Privacy Guarantees](PRIVACY.md) — detailed privacy model
- [Circuit Specifications](CIRCUITS.md) — circuit constraints
- [Smart Contracts](CONTRACTS.md) — contract API reference
- [Deployment Addresses](DEPLOYMENTS.md) — testnet contracts
- [Developer Guide](DEVELOPER_GUIDE.md) — setup and testing

---

**Questions?** Open a GitHub issue or join our Discord.
