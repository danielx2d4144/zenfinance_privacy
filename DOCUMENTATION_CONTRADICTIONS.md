# Documentation Contradictions Analysis

**Created:** 2026-08-19  
**Purpose:** Identify conflicting information across all .md files to establish clear project goals

---

## 🔴 CRITICAL CONTRADICTIONS

### 1. VK Format Status (RESOLVED but docs conflict)

**GROUND_TRUTH.md says:**
- All VKs are Poseidon2 format, 3680 bytes (as of Day 14c)
- Kurier VK hash mismatch is the blocker

**NEXT_STEPS.md says:**
- Problem is Kurier expects 1888-byte Keccak VKs
- bb.js 3.0.x generates 3680-byte VKs
- Blocked on Horizen support response

**README.md says:**
- "All circuits use **Keccak oracle hash** (not Poseidon2) for zkVerify compatibility"
- VK format: 1888 bytes Keccak

**docs/ARCHITECTURE.md says:**
- Proofs use "Poseidon2/BN254"
- No mention of Keccak format

**ACTUAL STATUS (from summary):**
- ✅ **FIXED** on 2026-08-19 - Added `keccakZK: true` to all proofs
- ✅ All VKs re-derived as 1888-byte Keccak format
- ✅ All 11 VKs re-registered with Kurier
- 🔄 VkRegistry.sol needs redeployment with updated hashes

**Action needed:** Update GROUND_TRUTH.md, NEXT_STEPS.md, README.md to reflect the Keccak resolution.

---

### 2. Project Name & Branding

**README.md title:** "NoctFinance"  
**GROUND_TRUTH.md:** "ZenFinance" (line 1)  
**design-v2/pitch/zenfinance.md:** Exists (not read yet)  
**CCN_TECHNICAL_PIVOT.md:** "Confidential Credit Network (CCN)"  

**Three different names for the same project!**

**Action needed:** Pick ONE name and update all docs.

---

### 3. Multi-Asset vs Single-Asset Launch

**design-v2/architecture_overview.md:**
- "Multi-asset positions from day one"
- "Architecture supports {USDC, cbBTC, WETH, ZEN}"
- "v1 ships with only USDC + cbBTC enabled"

**GROUND_TRUTH.md:**
- No mention of multi-asset architecture
- Lists "11 circuits" but doesn't specify asset support

**README.md:**
- "Supported Assets (Testnet): USDC, ZEN, WETH"
- No mention of cbBTC

**docs/ARCHITECTURE.md:**
- Created by me during Phase 2 documentation
- May not reflect design-v2 specs

**Action needed:** Clarify if design-v2 is the current plan or if it's outdated.

---

### 4. Contract Architecture (Two Different Designs)

**design-v2/architecture_overview.md (2024-era design):**
```
ShieldedSupplyPool.sol
ShieldedBorrowPool.sol (called "ShieldedPositionPool" in places)
LiquidationBoard.sol
PrivacyEntry.sol
AgentAccount.sol (ERC-4337)
PolicyRegistry.sol
```

**GROUND_TRUTH.md (what's actually built):**
```
11 contracts including:
- PrivacyEntry
- ShieldedSupplyPool
- ShieldedPositionPool
- LiquidationBoard
- AgentAccount
- PolicyRegistry
- AssetRegistry
- Oracle
- RateModel
- InsuranceFund
- ZkVerifier
```

**README.md (my created docs):**
```
Pool
AssetManager
InterestRateModel
PrivacyEntry
CommitmentRegistry
NullifierRegistry
ZkVerifier
VkRegistry
ChainlinkAdapter
```

**Action needed:** Document which contracts ACTUALLY exist in code/contracts/src/ right now.

---

### 5. Circuit Count Mismatch

**GROUND_TRUTH.md:** "11 circuits" (Poseidon2/BN254)

**design-v2/architecture_overview.md:** "~12 Noir circuits"

**README.md:** "11 Noir circuits" (lists all 11)

**docs/ARCHITECTURE.md:** May list different circuits

**CCN_TECHNICAL_PIVOT.md:** Adds 2 NEW circuits:
- `auditor_disclose.nr`
- `non_rehyp_attest.nr`

**Action needed:** Count actual circuits in code/circuits/ directory and reconcile.

---

### 6. Oracle Provider Conflict

**GROUND_TRUTH.md:**
- "price-keeper (Stork)" - Stork is the oracle

**design-v2/architecture_overview.md:**
- "Oracle.sol wraps Stork"

**CCN_TECHNICAL_PIVOT.md:**
- "Stork stays for consumer USDC/cbBTC/WETH/ZEN markets"
- "RedStone is added for RWA assets"

**README.md:**
- "ChainlinkAdapter ← price feeds for liquidations"

**Action needed:** Clarify which oracle is ACTUALLY integrated.

---

### 7. Deployment Status Confusion

**GROUND_TRUTH.md:**
- Last verified: 2026-07-30
- "Horizen testnet 2651420 is LIVE"
- "Attestation E2E BUILT on Base Sepolia"
- "zkVerify proxy has NEVER been verified on Horizen testnet"

**docs/DEPLOYMENTS.md (created by me):**
- Shows Horizen testnet contracts deployed
- Includes VK hashes

**README.md:**
- "Live Deployment: Horizen Testnet 🟢 Active"

**NEXT_STEPS.md:**
- "Current Status: BLOCKED on Kurier VK Size Mismatch"

**ACTUAL STATUS (from summary):**
- VK issue RESOLVED on 2026-08-19
- VkRegistry needs redeployment
- Live proof testing pending

**Action needed:** Update deployment status across all docs.

---

### 8. CCN Pivot vs Original Design

**CCN_TECHNICAL_PIVOT.md introduces:**
- RWA collateral (ACRED, BUIDL, SCOPE tokens)
- RedStone oracle for NAV feeds
- Merkle-tree auditor keys
- Proof-of-Non-Rehypothecation
- Base deployment (not Horizen)
- "Confidential Credit Network" rebranding

**ALL OTHER DOCS:**
- No mention of RWA support
- No mention of institutional pivot
- No mention of Base deployment
- No mention of CCN branding

**Is CCN the new direction or a separate product?**

**Action needed:** Clarify if CCN replaces the consumer lending protocol or runs parallel.

---

### 9. design-v2 vs Current Implementation

**design-v2/ folder:**
- Last modified unknown
- 17 subsystems documented
- Agent-first design with MCP server
- ERC-4337 smart accounts
- "8-12 months with 4-6 engineers" timeline
- "$1.2M-$2.2M total to audited mainnet"

**GROUND_TRUTH.md:**
- States design-v2 is RETIRED for day-locked roadmap
- "MILESTONES.md (M1–M4) is plan of record"
- But MILESTONES.md doesn't exist in repo!

**Action needed:** Determine if design-v2 is active or historical reference only.

---

### 10. Proof System Terminology

**GROUND_TRUTH.md:**
- "Poseidon2/BN254 circuits"
- "vkHashes pinned Day 14c"

**design-v2/architecture_overview.md:**
- "UltraHonk (Noir + bb v3)"
- "Groth16/UltraHonk proof"

**README.md:**
- "UltraHonk Proofs via Noir + Barretenberg"
- "Keccak oracle hash format (1888 bytes)"

**All three are technically different proof systems!**
- UltraHonk ≠ Groth16 (different proving systems)
- Poseidon2 ≠ Keccak (different hash functions)

**Action needed:** Specify EXACT proving system: UltraHonk with Keccak oracle.

---

## 🟡 MODERATE CONTRADICTIONS

### 11. Testnet vs Mainnet Language

Many docs mix "testnet" and "production" language ambiguously.

**GROUND_TRUTH.md:**
- Clear: testnet only, mainnet gated on Gate 1 (which FAILED)

**README.md:**
- Says "Testnet deployment" but uses "Live Deployment" header

**Action needed:** Consistent "Testnet Phase" language everywhere.

---

### 12. Interest Accrual Model

**design-v2/architecture_overview.md:**
- "5-min interest accrual cadence"
- "Periodic public-index updates"

**GROUND_TRUTH.md:**
- No mention of accrual cadence

**docs/ARCHITECTURE.md:**
- May describe different model

**Action needed:** Document actual implementation.

---

## 🟢 MINOR CONTRADICTIONS

### 13. Documentation Strategy

Multiple overlapping architecture docs:
- `docs/ARCHITECTURE.md` (637 lines, created by me)
- `design-v2/architecture_overview.md` (original design)
- `GROUND_TRUTH.md` (canonical state)

**Action needed:** Merge or clearly scope each doc's purpose.

---

## 📋 RECOMMENDED ACTIONS

### Immediate (This Session)

1. **Establish Name:** NoctFinance vs ZenFinance vs CCN?
2. **Resolve VK Status:** Update all docs to reflect Keccak fix
3. **Clarify CCN Status:** Separate product or pivot?
4. **Verify Contracts:** List what actually exists in code/

### Short-term (Next Session)

5. **Archive design-v2/** if retired, or mark as "Reference Only"
6. **Create MILESTONES.md** if it's the plan of record
7. **Reconcile Architecture Docs:** One source of truth
8. **Update GROUND_TRUTH.md** to 2026-08-19

### Before Next Implementation

9. **Read actual contract files** to verify architecture
10. **Count actual circuits** in code/circuits/
11. **Verify oracle integration** (Stork vs Chainlink vs RedStone)

---

## ✅ DOCS THAT ARE INTERNALLY CONSISTENT

- **GLOSSARY.md** - No contradictions, good reference
- **CHANGELOG.md** - Accurate VK format history
- **docs/ZENDEX_PATTERNS_ANALYSIS.md** - Self-contained
- **docs/LAYRS_PATTERNS_ANALYSIS.md** - Self-contained
- **Fixing the VK Registration Issue.md** - Historical record

---

## 🎯 SUGGESTED GROUND TRUTH HIERARCHY

1. **GROUND_TRUTH.md** - Canonical state (needs update to 2026-08-19)
2. **Git history + actual code** - What's actually built
3. **NEXT_STEPS.md** - Current blockers (needs update: VK resolved)
4. **design-v2/** - Historical reference only (mark as archived?)
5. **CCN_TECHNICAL_PIVOT.md** - Proposed future direction (not current)
6. **My created docs** (README, ARCHITECTURE, DEPLOYMENTS) - Documentation layer (needs reconciliation)

---

**Bottom line:** You have THREE different visions documented:
1. **What was built** (GROUND_TRUTH.md, July 2026)
2. **What was designed** (design-v2/, earlier)
3. **What could be built** (CCN pivot, institutional)

**We need to pick ONE as the current goal and align all docs to it.**
