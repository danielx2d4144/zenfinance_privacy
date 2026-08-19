# Technical Implementation Patterns from Layrs

**Source:** Layrs privacy prediction market documentation + contract analysis  
**For:** NoctFinance privacy lending implementation improvements

---

## Overview: What Layrs Does Differently

Layrs is a **privacy prediction market** that uses:
- TEE (Trusted Execution Environment) for private order matching
- RISC Zero zkVM for settlement proofs (not UltraHonk like us)
- zkVerify aggregation (same as us)
- "Additive evidence" pattern (proofs don't block core operations)

**Key insight:** Their privacy model is different from ours (TEE vs ZK circuits), but their **operational patterns** are highly relevant.

---

## Pattern 1: Additive Evidence Registry ⭐ HIGHEST VALUE

### The Layrs Approach

**Problem:** Proof generation/verification is slow and might fail. Do you block operations on proof availability?

**Layrs Solution:** "Additive evidence" pattern:

```solidity
/// @notice Additive, non-custodial registry for settlement proofs
/// @dev This contract does NOT modify or administer any pool, vault, or market
contract LayrsZkSettlementRegistry {
    // Records proof AFTER settlement already happened
    // Provides public evidence without blocking operations
    
    function attestSettlement(
        bytes calldata publicJournal,
        uint256 aggregationId,
        bytes32[] calldata merklePath,
        // ... proof verification
    ) external returns (bytes32 marketIdHash) {
        // Verify proof via zkVerify aggregation
        // Store attestation for public record
        // But settlement already happened in TEE
    }
}
```

**Key principles:**
1. **Operations happen first** (in TEE or privately)
2. **Proofs come later** (asynchronously)
3. **Registry is additive** (cannot block, cannot reverse)
4. **Public evidence** (anyone can verify settlement was correct)

### How This Applies to NoctFinance

**Current approach:** Proof MUST be verified before operation executes.

**Potential improvement:** Use additive evidence for certain operations:

```solidity
// Phase 1: User operation (immediate)
function supplyImmediate(bytes32 commitment, uint256 amount) external {
    // Accept supply immediately
    // Record pending proof requirement
    pendingProofs[commitment] = ProofPending({
        operation: OperationType.SUPPLY,
        deadline: block.timestamp + 1 hours,
        required: true
    });
    
    // User can trade immediately (better UX)
    _executeSupply(commitment, amount);
}

// Phase 2: Proof submission (async)
function submitSupplyProof(
    bytes calldata proof,
    bytes32 commitment
) external {
    // Verify proof via zkVerify
    // Mark proof as received
    pendingProofs[commitment].verified = true;
    
    // If proof fails, flag account for review
    // But operation already happened
}
```

**Trade-offs:**
- ✅ Better UX (no waiting for proofs)
- ✅ Higher throughput
- ❌ Requires trust in user during proof window
- ❌ Need fraud detection mechanism

**Recommendation:** Use for LOW-RISK operations only:
- ✅ Supply (adding funds)
- ✅ Repay (reducing debt)
- ❌ Borrow (taking funds) — keep proof-first
- ❌ Withdraw (removing funds) — keep proof-first

**Implementation effort:** Medium (3-4 days)

---

## Pattern 2: Explicit Scope Boundaries 🎯

### The Layrs Approach

**From their docs:**
```
Iteration 0 proves:
- exactly 25 observations for each boundary
- median as 13th value after ascending sort
- deterministic UP/DOWN/PUSH resolution
- market, chain, feed bindings

Iteration 0 does NOT prove:
- Pyth publisher signatures
- private order matching
- payout correctness
- fee correctness
```

**Why this matters:**
- Users know EXACTLY what's proven
- No overpromising
- Auditors know scope clearly
- Future iterations can expand scope

### How This Applies to NoctFinance

**We should create an EVIDENCE_SCOPE.md:**

```markdown
# NoctFinance ZK Proof Scope

## Version 0.1.0 (Testnet)

### What Our Circuits PROVE

**supply_asset circuit proves:**
✅ User owns old balance commitment (knows spending key + salt)
✅ Old commitment exists in Merkle tree
✅ New balance = old balance + supply amount
✅ Interest correctly accrued based on time
✅ Nullifier prevents double-spend of old commitment

**borrow circuit proves:**
✅ User owns collateral commitment
✅ Collateral value >= (borrow amount * collateralization ratio)
✅ New debt commitment correctly formed
✅ Health factor > liquidation threshold

### What Our Circuits DO NOT PROVE

❌ **Oracle price validity** — We trust Chainlink price feeds
❌ **Interest rate correctness** — We trust RateModel contract
❌ **Asset configuration** — We trust AssetRegistry admin
❌ **Epoch boundaries** — We trust block.timestamp
❌ **Cross-circuit atomicity** — Supply + borrow are separate proofs

### Trust Assumptions

**Cryptographic:**
- Poseidon2 is collision-resistant
- UltraHonk proving system is sound
- Keccak-256 is preimage-resistant

**Infrastructure:**
- zkVerify correctly verifies proofs
- Horizen EVM executes correctly
- Chainlink oracles are accurate

**Operational:**
- Smart contract admin is trustworthy (pre-governance)
- Frontend correctly generates witnesses
- Browser WASM runtime isn't compromised
```

**Implementation effort:** Low (documentation only, 1 day)

---

## Pattern 3: Idempotency & Replay Prevention 🔒

### The Layrs Pattern

```solidity
// Prevent double-attestation
mapping(bytes32 marketIdHash => Attestation) private attestations;

function attestSettlement(...) external returns (bytes32 marketIdHash) {
    if (attestations[marketIdHash].attestedAt != 0) {
        revert MarketAlreadyAttested();
    }
    // ... store attestation
}
```

**Key insight:** Market ID → single attestation (idempotent).

### How This Applies to NoctFinance

**We already prevent nullifier reuse, but could improve idempotency:**

```solidity
// Current: Only nullifier check
mapping(bytes32 => bool) public nullifiersUsed;

// Proposed: Add operation replay prevention
struct ProofVerification {
    bytes32 nullifier;
    bytes32 proofHash;  // Hash of proof + public inputs
    uint64 verifiedAt;
    bool consumed;
}

mapping(bytes32 proofHash => ProofVerification) public verifications;

function verifyAndConsume(
    uint8 circuitId,
    bytes32 expectedVkHash,
    AggregationProof calldata proof
) external returns (bytes32 nullifier) {
    bytes32 proofHash = keccak256(abi.encode(proof.publicInputs));
    
    // Idempotency: same proof can't be verified twice
    if (verifications[proofHash].verifiedAt != 0) {
        revert ProofAlreadyVerified();
    }
    
    // Verify via zkVerify
    _verifyProof(circuitId, proof);
    
    // Extract nullifier from public inputs
    nullifier = bytes32(proof.publicInputs[NULLIFIER_INDEX]);
    
    // Store verification
    verifications[proofHash] = ProofVerification({
        nullifier: nullifier,
        proofHash: proofHash,
        verifiedAt: uint64(block.timestamp),
        consumed: false
    });
    
    // Mark nullifier as used
    nullifiersUsed[nullifier] = true;
}
```

**Benefits:**
- Prevents replay of same proof
- Enables proof tracking/auditing
- Can query "was this proof verified?"

**Implementation effort:** Low-Medium (1-2 days)

---

## Pattern 4: Public Journal ABI Specification 📋

### The Layrs Pattern

**From their spec:**
```
The journal is exactly 480 bytes: fifteen 32-byte big-endian words.

| Word | Value |
|------|-------|
| 0    | SHA-256 proof-program version |
| 1    | SHA-256 canonical market ID |
| 2    | Horizen chain ID (26514) |
| 3    | Pyth ZEN/USD feed ID (245) |
| 4    | opening median, signed E8 |
| 5    | closing median, signed E8 |
| ...  | ... |
```

**Why this matters:**
- Fixed-size journal = easier verification
- Documented ABI = auditable
- Version hash = upgradeable proofs

### How This Applies to NoctFinance

**We should document our public input ABI:**

```markdown
# NoctFinance Public Input Specification

## supply_asset Circuit

**Public inputs (exactly 7 field elements, 32 bytes each):**

| Index | Field | Type | Description |
|-------|-------|------|-------------|
| 0 | `asset_id` | uint256 | Asset being supplied (1=USDC, 2=ZEN, ...) |
| 1 | `root_balance` | bytes32 | Merkle root of balance tree |
| 2 | `balance_nullifier_pub` | bytes32 | Nullifier for old balance commitment |
| 3 | `residual_balance_commitment` | bytes32 | New balance commitment after supply |
| 4 | `supply_commitment_pub` | bytes32 | New supply position commitment |
| 5 | `amount` | uint256 | Amount being supplied (in asset decimals) |
| 6 | `supply_index_now` | uint256 | Current supply index for interest calculation |

**Validation rules:**
- `asset_id` must be registered in AssetRegistry
- `root_balance` must match current on-chain Merkle root
- `balance_nullifier_pub` must not exist in NullifierRegistry
- `amount` must be > 0 and <= 2^128
- `supply_index_now` must match current pool index (±1 block tolerance)
```

**Implementation effort:** Low (documentation + tests, 1 day)

---

## Pattern 5: Reproducible Evidence & Verification Commands 🔍

### The Layrs Pattern

**Every claim has a "Reproduce" command:**

| Claim | Reproduce |
|-------|-----------|
| Deterministic resolution proof | `cargo test --manifest-path proof/core/Cargo.toml` |
| Horizen proof attestation | `forge test --root contracts` |
| zkVerify verification | `node scripts/verify-evidence.mjs` |
| Production automation | `node scripts/verify-production-automation.mjs` |

### How This Applies to NoctFinance

**We should create `scripts/verify-evidence.mjs`:**

```javascript
#!/usr/bin/env node
/**
 * NoctFinance Evidence Verifier
 * 
 * Reproduces all public claims:
 * 1. VKs match on-chain hashes
 * 2. Kurier VK hashes match registered values
 * 3. Deployment addresses are verified on explorer
 * 4. Test proofs verify correctly
 */

import { readFileSync } from 'fs';
import { createPublicClient, http } from 'viem';

const HORIZEN_RPC = 'https://gobi-rpc.horizenlabs.io/ethv1';
const ZK_VERIFIER_ADDRESS = '0xb30323cabcbc75cb4f789232c4dad3793f2a8aa5';

async function verifyOnChainVKHashes() {
  console.log('Verifying on-chain VK hashes...');
  
  const client = createPublicClient({
    transport: http(HORIZEN_RPC)
  });
  
  // Read expected VK hashes from derive-vks output
  const expected = JSON.parse(readFileSync('code/circuits/vk-hashes.json'));
  
  // Query on-chain VK hash for each circuit
  for (const [circuitId, expectedHash] of Object.entries(expected)) {
    const onChainHash = await client.readContract({
      address: ZK_VERIFIER_ADDRESS,
      abi: [{ name: 'getVkHash', type: 'function', inputs: [{ type: 'uint8' }], outputs: [{ type: 'bytes32' }] }],
      functionName: 'getVkHash',
      args: [circuitId]
    });
    
    if (onChainHash !== expectedHash) {
      throw new Error(`Circuit ${circuitId}: VK hash mismatch!`);
    }
    console.log(`✓ Circuit ${circuitId}: ${onChainHash}`);
  }
}

async function verifyKurierRegistration() {
  console.log('\nVerifying Kurier VK registration...');
  // Query Kurier API to confirm VKs are registered
  // ...
}

async function verifyTestProof() {
  console.log('\nVerifying test proof...');
  // Generate a proof and verify it goes through the full flow
  // ...
}

async function main() {
  console.log('NoctFinance Evidence Verifier\n');
  await verifyOnChainVKHashes();
  await verifyKurierRegistration();
  await verifyTestProof();
  console.log('\n✅ All evidence verified!');
}

main().catch(console.error);
```

**Also create `docs/EVIDENCE_INDEX.md`:**

```markdown
# NoctFinance Evidence Index

| Claim | Coverage | Source | Deployed Evidence | Reproduce |
|-------|----------|--------|-------------------|-----------|
| VK hashes match contracts | All 11 circuits have correct Keccak VK hashes on-chain | `derive-vks.mjs` commit abc123 | ZkVerifier at 0xb30323... | `node scripts/verify-evidence.mjs` |
| Kurier VK registration | All VKs registered with zkVerify Kurier API | `register-all-vks.ts` commit def456 | Kurier API response logs | `npm run verify-kurier-vks` |
| Circuit correctness | Circuits prove correct constraints | Noir source + tests | Test vectors in `code/circuits/*/tests/` | `nargo test --workspace` |
```

**Implementation effort:** Medium (2-3 days for full suite)

---

## Pattern 6: Fail-Closed Automation 🤖

### The Layrs Pattern

**From their security addendum:**

```
Production worker:
- Compares embedded RISC Zero image ID with registry BEFORE claiming work
- Retries while zkVerify aggregation roots propagate
- Failed jobs ALERT and enter manual review (not publish weaker statement)
- Duplicate market attestations rejected on-chain
```

**Key principle:** Automation fails closed (doesn't publish bad data).

### How This Applies to NoctFinance

**When we build prover service (Phase 3+), use fail-closed pattern:**

```typescript
// code/backend/prover-service/src/automation/proof-worker.ts

class ProofWorker {
  async processIntent(intentId: string) {
    try {
      // 1. Verify we're running correct circuit version
      const expectedVK = await this.getExpectedVKFromRegistry();
      const localVK = await this.getLocalVK();
      if (expectedVK !== localVK) {
        throw new Error('VK mismatch - circuit version out of sync');
      }
      
      // 2. Generate proof
      const proof = await this.generateProof(intent);
      
      // 3. Submit to Kurier
      const job = await this.submitToKurier(proof);
      
      // 4. Poll with retries (fail-closed)
      const result = await this.pollWithRetries(job.id, {
        maxRetries: 10,
        timeout: 300_000, // 5 min
        onFailure: () => {
          // FAIL CLOSED: Alert ops, don't mark as success
          this.alertOps({ intentId, jobId: job.id, error: 'timeout' });
          throw new Error('Proof job timed out');
        }
      });
      
      // 5. Only mark success if verified
      if (result.status === 'Aggregated') {
        await this.markIntentComplete(intentId);
      } else {
        throw new Error(`Unexpected status: ${result.status}`);
      }
      
    } catch (error) {
      // FAIL CLOSED: Log error, alert, manual review
      await this.logFailure(intentId, error);
      await this.alertOps({ intentId, error });
      await this.markForManualReview(intentId);
      // DO NOT mark as success
    }
  }
}
```

**Implementation effort:** Medium (built into prover service, 2 days)

---

## Pattern 7: Adoption Metrics with Privacy Boundary 📊

### The Layrs Pattern

**From ADOPTION_RECONCILIATION.md:**

```
The public adoption surface reports aggregate protocol activity.

Reported metrics:
- Unique private commitments: 6
- Private sessions: 567
- Deposits: 29
- Withdrawals: 23

Deliberately NOT counted:
- Staff/test identities
- Duplicated identities
- Failed transactions
- Dust-only activity

NO wallet list or identity-to-portfolio mapping is published.
```

**Why this matters:**
- Shows adoption WITHOUT compromising privacy
- Transparent methodology
- Auditable aggregates
- No PII

### How This Applies to NoctFinance

**Create `GET /api/v1/adoption` endpoint:**

```typescript
// code/backend/data-api/src/routes/adoption.ts

interface AdoptionMetrics {
  uniqueCommitments: number;
  totalOperations: {
    deposits: number;
    withdraws: number;
    supplies: number;
    borrows: number;
    repays: number;
    liquidations: number;
  };
  tvlUSD: number; // Aggregate only, no per-user
  activeBorrowersLast7Days: number;
  timestamp: string;
  methodology: string;
}

export async function getAdoptionMetrics(): Promise<AdoptionMetrics> {
  // Query aggregates only - no PII
  const uniqueCommitments = await db.commitments.countDistinct();
  const deposits = await db.operations.count({ type: 'deposit' });
  // ... other aggregates
  
  return {
    uniqueCommitments,
    totalOperations: { deposits, ... },
    tvlUSD: await calculateTVL(),
    activeBorrowersLast7Days: await countActiveBorrowers(7),
    timestamp: new Date().toISOString(),
    methodology: 'https://docs.noctfinance.xyz/adoption-methodology'
  };
}
```

**Also create `docs/ADOPTION_METHODOLOGY.md`:**

```markdown
# Adoption Metric Methodology

## What We Count

✅ Unique commitments created
✅ Total operations (by type)
✅ Aggregate TVL (USD)
✅ Active users (last 7 days)

## What We DON'T Publish

❌ Individual wallet addresses
❌ Per-user balances or positions
❌ Commitment-to-user mappings
❌ Transaction-to-wallet links

## Privacy Guarantee

All metrics are aggregates computed server-side. No client IP addresses,
wallet addresses, or commitment ownership mappings are ever published.
```

**Implementation effort:** Medium (2-3 days with docs)

---

## Pattern 8: Version-Pinned Proof Programs 📌

### The Layrs Pattern

```solidity
// Pin exact proof program version
bytes32 public constant PROGRAM_VERSION_HASH = 
    0x9b61f2e5b557ccb7d50440bf2797642dca0b62cb3c2d984d0b4fcfd477d9690b;

bytes32 public constant RISC_ZERO_V2_2_VERSION_HASH =
    0xb3321f8b04ee9a754860a415c691f00756990e2054e5023f1a68c260a7042efe;

function _decode(bytes calldata journal) private pure {
    // Verify program version matches
    if (_word(journal, 0) != PROGRAM_VERSION_HASH) {
        revert InvalidPublicJournal();
    }
    // ...
}
```

**Why this matters:**
- Contract only accepts proofs from EXACT circuit version
- Prevents accepting proofs from modified circuits
- Enables upgrades (deploy new registry with new version hash)

### How This Applies to NoctFinance

**Add circuit version pinning:**

```solidity
// In VkRegistry.sol
library VkRegistry {
    // Current circuit version (Noir 1.0.0-beta.18, bb.js 3.0.0-rc.6, Keccak format)
    bytes32 public constant CIRCUIT_VERSION_HASH = 
        0x<hash-of-all-circuit-bytecodes>;
    
    bytes32 public constant NOIR_COMPILER_VERSION = 
        0x<hash-of-noir-1.0.0-beta.18>;
    
    uint256 public constant DEPLOYED_AT = 1723987200; // 2026-08-19
    
    // ... VK hashes
}

// In ZkVerifier.sol
function verifyAndConsume(
    uint8 circuitId,
    bytes32 expectedVkHash,
    AggregationProof calldata proof
) external {
    // Verify VK hash matches current version
    bytes32 registryVkHash = VkRegistry.getVkHash(circuitId);
    if (expectedVkHash != registryVkHash) {
        revert VkHashMismatch();
    }
    
    // Could also check circuit version in proof metadata
    // ...
}
```

**Implementation effort:** Low (1 day)

---

## Summary: Priority Implementation

### High Priority (Phase 2-3)

1. **Explicit Scope Boundaries** (1 day) ⭐
   - Create EVIDENCE_SCOPE.md
   - Document what IS and ISN'T proven
   
2. **Public Input ABI Specification** (1 day) ⭐
   - Document exact public input format
   - Add validation tests

3. **Reproducible Evidence Scripts** (2-3 days) ⭐
   - Create verify-evidence.mjs
   - Create EVIDENCE_INDEX.md

### Medium Priority (Phase 3-4)

4. **Idempotency & Replay Prevention** (1-2 days)
   - Add proof hash tracking
   - Prevent duplicate proof verification

5. **Fail-Closed Automation** (2 days)
   - Build into prover service
   - Alert on failures

6. **Adoption Metrics with Privacy** (2-3 days)
   - Create /api/v1/adoption endpoint
   - Document methodology

### Low Priority (Phase 4+)

7. **Additive Evidence Registry** (3-4 days)
   - Async proof submission for low-risk ops
   - Requires fraud detection

8. **Version-Pinned Circuits** (1 day)
   - Add circuit version hashing
   - Version mismatch detection

---

## Key Takeaways from Layrs

1. **Transparency > Secrecy** — Publish methodology, not data
2. **Fail Closed** — Never publish wrong data, even if automation breaks
3. **Explicit Scope** — Say what you prove AND what you don't
4. **Reproducibility** — Every claim has a verification command
5. **Privacy in Aggregates** — Show adoption without compromising users

**Most valuable pattern:** Explicit scope boundaries + reproducible evidence = audit-ready documentation.

---

**Created:** `docs/LAYRS_PATTERNS_ANALYSIS.md`  
**Next:** Review with team, prioritize for Phase 3 implementation
