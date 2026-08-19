# NoctFinance Documentation Strategy

**Based on analysis of:** Zendex (ZK-AMM) and Layrs (privacy prediction markets)

---

## Key Patterns from Horizen Ecosystem Projects

### 1. **Zendex Strengths**
- **Accessibility-first**: Explains complex ZK concepts in plain language
- **Problem/solution format**: Clear "what problem does this solve" section
- **Visual hierarchy**: Tables, code blocks, and clear sections
- **Glossary**: Comprehensive term definitions at the end
- **User journey**: Step-by-step walkthrough of typical flows
- **Module structure**: Breaks complex system into digestible modules

### 2. **Layrs Strengths**
- **Evidence-based**: Everything is verifiable and reproducible
- **Scope transparency**: Explicitly states what IS and ISN'T covered
- **Trust boundaries**: Clear about what's proven vs assumed
- **Reproducibility**: Every claim has a "Reproduce" command
- **Version-specific**: Explicit iteration numbers and status
- **Technical precision**: Exact specs for public interfaces

---

## NoctFinance Documentation Structure

### Primary Documents (Create These)

#### 1. `README.md` (Entry Point)
**Audience:** Developers discovering the project  
**Purpose:** Quick orientation and getting started

```markdown
# NoctFinance

Privacy-preserving lending protocol on Horizen.

## What is NoctFinance?

NoctFinance lets users deposit, supply, borrow and liquidate cryptocurrency 
privately. Unlike Aave or Compound where every action is public, NoctFinance 
wraps operations in Zero-Knowledge Proofs verified by zkVerify.

## Quick Start
- [Developer Guide](docs/DEVELOPER_GUIDE.md)
- [Architecture Overview](docs/ARCHITECTURE.md)
- [Privacy Guarantees](docs/PRIVACY.md)
- [Smart Contracts](docs/CONTRACTS.md)

## Live Deployment
| Network | Chain ID | Status |
|---------|----------|--------|
| Horizen Testnet | 2651420 | Active |

[Contract Addresses](docs/DEPLOYMENTS.md)
```

---

#### 2. `docs/ARCHITECTURE.md` (Technical Overview)
**Audience:** Engineers evaluating the system  
**Purpose:** High-level system design

**Structure:**
1. **Core Problem NoctFinance Solves** (table like Zendex)
2. **Key Technologies** (Noir, UltraHonk, Poseidon2, zkVerify)
3. **Privacy Model** (commitments, nullifiers, Merkle trees)
4. **System Components**
   - Frontend (Next.js dapp)
   - Backend (data-api, prover-service)
   - Circuits (11 Noir circuits)
   - Contracts (ZkVerifier, Pool, VkRegistry)
5. **Proof Flow Diagram**
6. **Data Flow** (like Layrs' information flow)

---

#### 3. `docs/PRIVACY.md` (Privacy Guarantees)
**Audience:** Security researchers, auditors  
**Purpose:** Explicit privacy claims and boundaries

**Structure (inspired by Layrs):**
1. **Public Claim**: What privacy does NoctFinance provide?
2. **Trust Boundary**: What's inside ZK proofs vs public
3. **Privacy Guarantees**
   - Balance privacy
   - Transaction unlinkability
   - Amount privacy
   - Recovery from spending key only
4. **Explicit Exclusions** (like Layrs)
   - Deposit addresses are public
   - On-chain events are public (but encrypted)
   - Network-level anonymity requires Tor/VPN
5. **Threat Model**: What attacks are mitigated, what aren't

---

#### 4. `docs/CIRCUITS.md` (ZK Circuit Specification)
**Audience:** ZK engineers, auditors  
**Purpose:** Precise circuit behavior

**Structure (Layrs-style precision):**
1. **Circuit List** (11 circuits with one-line descriptions)
2. **Per-Circuit Specs**:
   - **Normative claim**: "This circuit proves X without revealing Y"
   - **Public inputs**: Exact field elements exposed
   - **Private inputs**: What remains hidden
   - **Constraints**: What the circuit checks
   - **Trusted assumptions**: Poseidon2 collision resistance, etc.
3. **Witness Generation**: How private inputs are constructed
4. **VK Format**: Keccak 1888-byte format for zkVerify

---

#### 5. `docs/DEVELOPER_GUIDE.md` (Getting Started)
**Audience:** New contributors  
**Purpose:** Set up and build the project

**Structure:**
1. **Prerequisites** (Node 22, Rust, Foundry, Noir)
2. **Repository Structure** (monorepo layout)
3. **Quick Start**
   ```bash
   npm install
   npm run build:circuits
   npm run test:contracts
   npm run dev
   ```
4. **Development Workflow**
   - Circuit changes → regenerate VKs → update contracts
   - Contract changes → redeploy → update frontend
5. **Testing Guide**
6. **Common Issues** (FAQ)

---

#### 6. `docs/DEPLOYMENTS.md` (Contract Addresses)
**Audience:** Integrators, frontend devs  
**Purpose:** Canonical deployed addresses

**Structure (Zendex-style):**
```markdown
| Contract | Address | Verified |
|----------|---------|----------|
| ZkVerifier | 0x1234... | ✅ |
| Pool (Horizen Testnet) | 0x5678... | ✅ |
| VkRegistry | 0xabcd... | ✅ |
| USDC (testnet) | 0xef01... | ✅ |

## VK Hashes
| Circuit | Keccak VK Hash |
|---------|----------------|
| supply_asset | 0x25acc0... |
| borrow | 0x08d369... |
...
```

---

#### 7. `docs/EVIDENCE.md` (Reproducibility Index)
**Audience:** Auditors, skeptics  
**Purpose:** Prove every claim is verifiable

**Structure (Layrs-inspired):**
| Claim | Coverage | Source | Deployed Evidence | Reproduce |
|-------|----------|--------|-------------------|-----------|
| Supply proof verified by zkVerify | UltraHonk proof for supply_asset circuit | Circuit at commit `abc123` | zkVerify tx `0xdef...` | `node scripts/test-supply-proof.mjs` |
| VK registered with Kurier | 1888-byte Keccak VK | VK at `code/circuits/supply_asset/target/vk` | Kurier hash `0x6d827a...` | `npm run register-vks` |

---

#### 8. `docs/USER_GUIDE.md` (End-User Documentation)
**Audience:** Non-technical users  
**Purpose:** How to use the dapp

**Structure (Zendex user journey):**
1. **Typical User Journey**
   - Connect wallet
   - Deposit USDC → receive encrypted note
   - Supply USDC → proof generated → aggregated by zkVerify
   - Borrow ZEN → private loan created
   - Repay → loan closed
   - Withdraw → USDC back to wallet
2. **Privacy in Practice**: What observers see vs don't see
3. **Recovery**: How to restore access from spending key
4. **FAQ**

---

#### 9. `SECURITY.md` (Security Model)
**Audience:** Security researchers  
**Purpose:** Responsible disclosure + security posture

**Structure (Layrs SECURITY_ADDENDUM style):**
1. **Threat Model**: What attacks are in/out of scope
2. **Controls**: What mitigations are in place
3. **Test Gates**: What automated checks run
4. **Residual Risks**: Known limitations
5. **Responsible Disclosure**: How to report vulnerabilities
6. **Audit Status**: Link to audit reports (when available)

---

### Secondary Documents

#### 10. `GLOSSARY.md`
**Purpose:** Term definitions (like Zendex §13)

Terms to define:
- Commitment, Nullifier, Merkle tree, Poseidon2
- UltraHonk, Noir, Barretenberg
- zkVerify, Kurier, aggregation
- Spending key, view key
- VK, Keccak format
- IMT (Indexed Merkle Tree)

---

#### 11. `CHANGELOG.md`
**Purpose:** Version history and breaking changes

Format:
```markdown
## [Unreleased]

### Added
- Keccak VK format for zkVerify compatibility

### Changed
- Switched from Poseidon2 to Keccak oracle hash

### Fixed
- Recovery scan cursor caching

## [0.1.0] - 2026-08-19
- Initial testnet deployment
```

---

#### 12. `CONTRIBUTING.md`
**Purpose:** How to contribute code

Sections:
- Code style (Prettier, ESLint)
- Commit message format
- PR template
- Testing requirements
- Circuit changes checklist

---

## Documentation Principles (From Analysis)

### 1. **Precision Over Marketing** (Layrs pattern)
- State exactly what IS proven, not what might be proven
- Explicit exclusions prevent overselling
- Version everything (Iteration 0, v1.0.0)

### 2. **Accessibility First** (Zendex pattern)
- Explain ZK concepts in plain language
- Use tables for comparisons
- Provide glossary for technical terms

### 3. **Reproducibility** (Layrs pattern)
- Every claim has a verification command
- Public evidence can be independently checked
- Git commit hashes for source provenance

### 4. **User Journey Focus** (Zendex pattern)
- Walk through typical flows step-by-step
- Show what users see at each stage
- Include error cases and edge cases

### 5. **Scope Transparency** (Layrs pattern)
- "This does X. This does NOT do Y."
- Trust boundaries clearly marked
- Assumptions explicitly stated

---

## Implementation Priority

### Phase 1: Core Docs (This Week)
1. ✅ Fix VK format (done)
2. Update VkRegistry and redeploy
3. Write `README.md` (entry point)
4. Write `docs/ARCHITECTURE.md` (system overview)
5. Write `docs/DEPLOYMENTS.md` (contract addresses)

### Phase 2: Developer Docs (Next Week)
6. Write `docs/DEVELOPER_GUIDE.md` (getting started)
7. Write `docs/CIRCUITS.md` (circuit specs)
8. Write `CONTRIBUTING.md`
9. Update existing code comments

### Phase 3: Transparency Docs (Before Mainnet)
10. Write `docs/PRIVACY.md` (privacy guarantees)
11. Write `docs/EVIDENCE.md` (reproducibility index)
12. Write `SECURITY.md` (security model)
13. Write `docs/USER_GUIDE.md` (end-user docs)
14. Write `GLOSSARY.md`

---

## Quick Wins We Can Do Now

1. **Add deployment table to root README** (like Zendex)
2. **Create GLOSSARY.md** with ZK terms (copy Zendex pattern)
3. **Document VK format fix** in CHANGELOG.md
4. **Add "Reproduce" column** to VK_FIX_COMPLETE.md (Layrs pattern)

---

## Example: NoctFinance README.md (Draft)

I'll create this next based on the patterns above.

---

**Status:** Documentation strategy complete. Ready to implement Phase 1 docs.
