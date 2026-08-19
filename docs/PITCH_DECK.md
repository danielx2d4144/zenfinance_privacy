# NoctFinance — Pitch Deck
### Private Lending, Proven On-Chain
**Horizen Ecosystem Grant Application · Technical Validation Request · 2026**

---

## Slide 1 — Cover

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║   ███╗   ██╗ ██████╗  ██████╗████████╗                           ║
║   ████╗  ██║██╔═══██╗██╔════╝╚══██╔══╝                           ║
║   ██╔██╗ ██║██║   ██║██║        ██║                              ║
║   ██║╚██╗██║██║   ██║██║        ██║                              ║
║   ██║ ╚████║╚██████╔╝╚██████╗   ██║                              ║
║   ╚═╝  ╚═══╝ ╚═════╝  ╚═════╝   ╚═╝  Finance                    ║
║                                                                  ║
║   The first lending protocol where position data never           ║
║   touches the public chain.                                      ║
║                                                                  ║
║   Built on Horizen · Verified by zkVerify · Proven in-browser   ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

**Contacts:** __ · __
**Grant Application** | Horizen Ecosystem Fund | August 2026

---

## Slide 2 — The Problem: DeFi Lending Has a Transparency Crisis

Every lending position on every public blockchain is a public record.

When you borrow on Aave, anyone can read:

- Your exact collateral amount and asset
- Your outstanding debt and interest accrual
- Your real-time health factor
- The precise liquidation price of your position
- Every historical transaction, linked to your wallet

This is not a theoretical concern. It is the operating model of every major DeFi lending protocol today.

### What this costs the market

**MEV and liquidation extraction.** Flashbots research documented over $675 million in extracted MEV on Ethereum from 2020–2022, with liquidation sandwich attacks representing a structurally unavoidable tax on undercollateralised borrowers.¹ The attack is impossible to prevent when the victim's health factor is public.

**Institutional exclusion.** Asset managers, family offices, and trading firms cannot expose position size, leverage, or counterparty exposure to competitors. No position privacy = no institutional participation. The addressable market for DeFi lending is artificially capped.

**Front-running on intent.** A large borrow or repay broadcast to the mempool signals intent before execution. Sophisticated actors extract value from the gap between intent and settlement.

**Surveillance risk.** On-chain lending history is permanent and public. In an era of tightening regulation (MiCA, FATF Travel Rule, SEC enforcement), linking a wallet to a large borrowed position creates compliance liability that many participants are unwilling to accept.

> "The public nature of blockchains is a feature for settlement finality. It is a bug for financial privacy."

---

*¹ Flashbots: "Quantifying MEV," https://writings.flashbots.net/quantifying-rev — $675M+ MEV extracted 2020–2022 on Ethereum alone.*

---

## Slide 3 — The Market Opportunity

### DeFi Lending: a $20B market with no privacy layer

| Protocol | TVL (peak / recent) | Privacy |
|---|---|---|
| Aave (all chains) | ~$22B peak, ~$12–18B ongoing | None |
| Compound | ~$3B | None |
| Morpho | ~$3B | None |
| **Privacy lending** | **$0** | — |

DeFi lending TVL has exceeded $20B across the top three protocols. The privacy segment is completely vacant. There is no incumbent to displace — only a gap to fill.

### Why now

Three forces converge in 2026:

1. **ZK infrastructure matures.** UltraHonk (Aztec/Noir) generates production-grade proofs in seconds on consumer hardware. Two years ago this took minutes on a server.

2. **Regulatory pressure increases the value of compliant privacy.** MiCA (effective 2024) and the FATF Travel Rule create demand for financial privacy that is provably selective — you can prove solvency to a regulator without revealing your counterparty list. ZK proofs are the only mechanism that enables this.

3. **Horizen's zkVerify goes live.** A neutral proof aggregation layer shared across applications eliminates the need for every protocol to run its own verifier infrastructure. The marginal cost of adding ZK verification to a lending protocol drops from "build a new L2" to "integrate an API."

### Total Addressable Market

- Institutional DeFi market: Bernstein Research estimates $650B in institutional digital asset AUM migrating on-chain by 2025.² Even 1% of that requiring private lending is a $6.5B opportunity.
- Retail: every DeFi user who has been front-run, liquidated by an MEV bot, or declined to borrow because their position would be public.

---

*² Bernstein Research, "Digital Asset 2025 Outlook," November 2024.*

---

## Slide 4 — The Solution: NoctFinance

NoctFinance is a collateralised lending protocol where **no position data appears on-chain in readable form**. Deposits, supplies, borrows, repayments, and collateral are all hidden behind zero-knowledge proofs.

### What the protocol hides

| Data point | Aave | NoctFinance |
|---|---|---|
| Deposit amount | Public | Private |
| Collateral asset and size | Public | Private |
| Borrowed amount | Public | Private |
| Health factor | Public | Private |
| Liquidation price | Public | Private |
| Wallet ↔ position link | Public | Private |

### How privacy is enforced — not trusted

NoctFinance does not hide data in a database behind a privacy policy. It enforces privacy cryptographically:

- Every protocol action (deposit, supply, borrow, repay, withdraw, collateral) generates a ZK proof that the action is valid without revealing any input values.
- Proofs are aggregated by Horizen's zkVerify network and verified on-chain by a single `verifyProofAggregation(...)` call.
- The on-chain state contains only Poseidon2 commitments — hash digests that are computationally indistinguishable from random values to anyone who does not hold the spending key.

**There is no trusted intermediary between the user's private state and the chain.** The math enforces the guarantee.

### The in-browser prover

Proof generation runs entirely in the user's browser via a Web Worker using `bb.js` (Aztec's UltraHonk reference implementation). The server never sees witness data. No centralized prover holds a copy of any user's financial state.

> **Status:** In-browser UltraHonk proving is operational on Horizen testnet (chain 2651420).

---

## Slide 5 — Technical Architecture

```
 Browser (user device)
 ┌──────────────────────────────────────────────────────────┐
 │  Next.js dapp                                            │
 │  ├── Key derivation  (EIP-712 → spending/viewing/storage)│
 │  ├── Note store      (local, encrypted at rest)          │
 │  ├── Proof Worker    (bb.js UltraHonk, Web Worker)       │
 │  └── Recovery scan   (eth_getLogs → trial-decrypt memos) │
 └─────────────────────────┬────────────────────────────────┘
                           │ REST intent
 ┌─────────────────────────▼────────────────────────────────┐
 │  data-api  (Fastify 5, Postgres, Railway)                 │
 │  ├── Intent queue   (mint / approve / deposit / verify)  │
 │  ├── Relayer EOA    (signs & submits chain txs)           │
 │  └── Kurier client  (submits proofs → zkVerify)           │
 └──────────────┬──────────────────────┬────────────────────┘
                │                      │
 ┌──────────────▼──────────┐  ┌────────▼────────────────────┐
 │  Horizen testnet        │  │  zkVerify / Kurier           │
 │  (chain 2651420)        │  │  (horizenlabs.io relayer)    │
 │  ├── ZkVerifier         │  │  ├── VK registration         │
 │  ├── PrivacyEntry       │  │  ├── Proof submission        │
 │  ├── ShieldedSupplyPool │  │  ├── Aggregation domain 175  │
 │  ├── ShieldedPositionPool│  │  └── Merkle receipt         │
 │  ├── Oracle (push mode) │  └─────────────────────────────┘
 │  └── + 6 more contracts │
 └─────────────────────────┘
```

### Circuit inventory (11 Noir circuits, UltraHonk/BN254/Poseidon2)

| Circuit | Function |
|---|---|
| `entry_deposit` | Commit to a deposit; emit encrypted memo |
| `entry_withdraw` | Prove note ownership; release funds |
| `supply_deposit` | Supply shielded liquidity |
| `supply_withdraw` | Withdraw supplied liquidity with private accrual |
| `borrow_open` | Open a borrow against private collateral |
| `borrow_repay` | Repay with private balance |
| `collateral_deposit` | Add collateral; prove healthy LTV |
| `collateral_withdraw` | Remove collateral; prove post-HF ≥ floor |
| `liquidate_partial` | Partial liquidation; prove undercollateralisation |
| `liquidate_full` | Full liquidation |
| `balance_transfer` | Move shielded balance between pools |

### Smart contract inventory (11 Solidity contracts)

`ZkVerifier` · `PrivacyEntry` · `ShieldedSupplyPool` · `ShieldedPositionPool` · `LiquidationBoard` · `AssetRegistry` · `RateModel` · `Oracle` · `InsuranceFund` · `tUSDC (faucet)` · `tcbBTC (faucet)`

All 11 contracts deployed at block 24,177,251 on Horizen testnet, Blockscout-verified.

---

## Slide 6 — Traction: What Is Already Built and Running

NoctFinance is not a whitepaper. The core cryptographic and contract infrastructure is complete and operational.

### Deployed and verified (Horizen testnet, 2651420)

| Contract | Address |
|---|---|
| ZkVerifier | `0xb30323CAbcBC75Cb4F789232C4DAD3793f2A8AA5` |
| PrivacyEntry | `0xaFf6608e440799c669145997fC230d51404A5142` |
| ShieldedSupplyPool | `0x43c5Ba0B57b5fb99B09f34De89825335D82681f1` |
| ShieldedPositionPool | `0x2433D5ef60b0444A2830636e754417eA76C7FE87` |
| Oracle | `0x852da28C9Bc35870eB01e2D49296b8c1E3204024` |
| zkVerify proxy | `0x3098A6974649478f0133046e44105AA84e868C21` |

### Milestones confirmed

- ✅ **11 Noir circuits** compiled, proving keys generated, VK hashes registered with Kurier
- ✅ **In-browser UltraHonk proving** operational — proofs generated entirely on the user's device via bb.js Web Worker
- ✅ **Deposit on Horizen testnet confirmed** — tx `0x226b6f445b4a7dbd07936fb541059d35e7fb24c18dc338d0b8dec4867ec251c1`, block 24,268,867, `Deposited` event on PrivacyEntry
- ✅ **zkVerify/Kurier pipeline proven** — full submission → aggregation → on-chain verification demonstrated on Base Sepolia (aggregation domain 2); Horizen domain 175 is wired and next in queue
- ✅ **Oracle live** — push-mode price feed (tUSDC $1.00, tcbBTC $64,053) running against `MAX_STALENESS_WINDOW = 3600s`
- ✅ **Recovery scan** — `eth_getLogs`-based memo recovery with Poseidon2 trial-decryption; restores full note state from on-chain logs + spending key alone
- ✅ **Encrypted note vault** — per-wallet AES-GCM vault; spending key never leaves the device

### Next milestone

Full supply + borrow producing `ProofConsumed` on the deployed ZkVerifier — UltraHonk proof submitted to Kurier, aggregated under domain 175, and verified on Horizen. Expected within two weeks of this submission.

---

## Slide 7 — Competitive Landscape

The privacy DeFi space is fragmented. No competitor combines private lending with ZK proof verification on a general-purpose chain.

| Protocol | Private lending | ZK proofs | In-browser proving | L1/L2 deployment | Lending TVL |
|---|---|---|---|---|---|
| **Aave** | ❌ | ❌ | N/A | Multi-chain L1+L2 | ~$12–18B |
| **Compound** | ❌ | ❌ | N/A | Ethereum L1 | ~$2–3B |
| **Aztec** | Partial³ | ✅ PLONK | Via Aztec node | Aztec L2 only | Limited |
| **Railgun** | Payments only | ✅ Groth16 | ❌ Server prover | Multi-chain | N/A (payments) |
| **Penumbra** | Staking/DEX | ✅ Groth16 | ❌ Full node | Cosmos only | N/A (Cosmos) |
| **Umbra** | ❌ | ❌ | N/A | Ethereum | Stealth only |
| **NoctFinance** | ✅ Full | ✅ UltraHonk | ✅ Native | Horizen testnet | — |

### Key differentiators

**vs. Aave / Compound:** The dominant protocols have no privacy roadmap. Their architecture is inherently public — adding privacy would require a complete redesign, not an upgrade. Their TVL is a measure of what a privacy-native alternative can capture.

**vs. Aztec:** Aztec is an L2 with a private execution environment. It is a complete alternative chain requiring deployment of a new network, not a protocol. Aztec's private lending is gated by the L2's own liquidity and its developer ecosystem, which is nascent. NoctFinance settles on Horizen testnet directly, using zkVerify's shared infrastructure.

**vs. Railgun:** Railgun is a privacy shield for ERC-20 transfers and DEX swaps, not a lending protocol. It has no concept of collateral, health factor, or interest accrual. RAILGUN Governance v2 added simple lending stubs but they are permissionless and unaudited.

**vs. Penumbra:** Penumbra is a Cosmos-native protocol. It provides private staking and a shielded DEX, but no EVM compatibility, no Ethereum integration, and no collateralised lending. It is an entirely different ecosystem.

**The UltraHonk advantage.** NoctFinance uses Noir + UltraHonk rather than Circom + Groth16 (Railgun, Penumbra) or custom PLONK (Aztec). UltraHonk is ~5–10× faster to prove than Groth16 on the same hardware,⁴ which is what makes in-browser proving practical. A Groth16-based system would require a server prover and would reintroduce a trusted intermediary.

---

*³ Aztec supports private token transfers; full private lending (collateral + health factor) requires custom contract development and Aztec SDK expertise.*  
*⁴ Aztec Labs engineering blog, "Honk: a new ZK proving system," 2024 — https://aztec.network/blog/honk-proving-system*

---

## Slide 8 — Roadmap

```
2026
├── Q3 (now)
│   ├── ✅ 11 contracts deployed, Blockscout-verified
│   ├── ✅ 11 circuits compiled, Kurier VKs registered
│   ├── ✅ In-browser proving operational (Horizen testnet)
│   ├── ✅ Deposit confirmed on-chain
│   ├── 🔄 Phase 2: Full borrow with live zkVerify aggregation (2 weeks)
│   └── 🔄 Phase 3: Hosted beta — invite gate, Railway/Vercel deploy (1 month)
│
├── Q4
│   ├── Phase 4: UX rebuild — position-native UI, guided borrow flow
│   ├── Audit: circuit constraint review + Solidity audit
│   ├── Mainnet readiness: liquidity bootstrapping, risk parameters
│   └── Horizen TEE integration (see below)
│
└── 2027 Q1
    ├── Mainnet launch
    └── Institutional onboarding: selective disclosure, regulatory reporting
```

### Horizen TEE Integration (Planned Roadmap)

The current architecture has one privacy gap: the relayer.

In the current design, the relayer EOA (`0xB19f1F29…2707`) submits transactions on behalf of users. Because the relayer constructs the transaction, it has access to:

- The encrypted memo (the proof's public inputs)
- Timing of each user action
- Association between wallet address and deposit/borrow intent

The relayer is trusted software run by the NoctFinance team. This is better than a public blockchain, but it is not cryptographic privacy.

**Horizen's Trusted Execution Environment (TEE) infrastructure closes this gap.** A TEE-hosted relayer would:

1. Accept encrypted witness data from the user's browser
2. Decrypt and process it inside the TEE's isolated enclave — outside the reach of the host OS, cloud provider, or NoctFinance team
3. Construct and submit the transaction without the plaintext ever being readable by any party

The result: not even the protocol operator can link a wallet to a position. Privacy guarantees become hardware-enforced, not policy-enforced.

This integration is not yet built. It is on the roadmap for Q4 2026, following the Horizen mainnet zkVerify deployment. The TEE attestation model will use the same Horizen infrastructure already hosting zkVerify, making it a natural extension of the existing relationship.

---

## Slide 9 — Team

**__ (Founder & CEO)**
__

**__ (Co-Founder & CTO)**
__

### What we've shipped

The NoctFinance codebase represents roughly 6 months of foundational engineering:

- 11 Solidity contracts with role-gated architecture, emergency pause, and insurance fund mechanics
- 11 Noir circuits covering the full lending lifecycle, each with constraint proofs and test vectors
- bb.js integration with Web Worker isolation and deterministic key derivation (EIP-712 → Poseidon2)
- Fastify 5 data-api with intent queue, Postgres WAL pattern, and crash-recovery sweep
- In-browser encrypted note vault with cross-tab writer lock
- End-to-end zkVerify/Kurier integration demonstrated on testnet

The team is small and the code surface is large. This is intentional: we built to the full protocol surface rather than a MVP subset, because the security guarantees only make sense at the whole-protocol level. A private deposit without a private borrow is not a product.

---

## Slide 10 — The Ask

### Grant: Horizen Ecosystem Fund

We are applying for an open-amount grant from the Horizen Ecosystem Fund. Any amount is welcome and will be deployed against the following:

**Relay infrastructure costs**
- Relayer EOA gas on Horizen testnet + mainnet
- Kurier proof submission fees (per-proof, metered)
- Railway hosting: data-api (always-on), Postgres, price-keeper cron
- Vercel: dapp hosting

**Horizen TEE integration R&D**
- Engineering time for TEE-hosted relayer design and implementation
- Hardware and testing infrastructure for TEE attestation verification
- Security review of the TEE enclave interface

**Circuit and contract audit**
- Independent constraint audit of all 11 Noir circuits (Aztec ecosystem auditor or equivalent)
- Solidity audit prior to mainnet deployment
- Formal verification of the Merkle proof path and nullifier uniqueness constraints

**Specific Horizen asks beyond direct grant**

1. **zkVerify domain 175 publisher confirmation** — We need confirmation that the Horizen aggregation domain (175) has an active publisher bot and an estimate of median time-to-`Aggregated` on a live proof. This is the single largest external dependency in our Phase 2 gate.

2. **Technical validation** — A review from the Horizen/zkVerify team of our aggregation domain usage, proof submission pipeline, and contract integration would accelerate our audit prep and give early users confidence in the architecture.

3. **Introduction to the Horizen ecosystem** — A co-marketing introduction to the Horizen developer community, particularly teams building with zkVerify, to identify potential liquidity partners and integration opportunities for the beta launch.

### Why Horizen

NoctFinance was designed for Horizen from the outset, not ported:

- zkVerify is the only production proof aggregation service with native EVM settlement — no ZK L2 required
- Horizen's 1-second block times (Caldera) match the UX model: a user should not wait minutes for a confirmation after waiting minutes for a proof
- The TEE roadmap is uniquely available here — no other ecosystem offers the combination of ZK proof aggregation + TEE infrastructure at the infrastructure layer
- We have already deployed, proved, and submitted on Horizen testnet. This is not speculative alignment.

---

## Appendix A — Deployed Contract Addresses

**Horizen Testnet (chain 2651420), deployment block 24,177,251**

```
ZkVerifier            0xb30323CAbcBC75Cb4F789232C4DAD3793f2A8AA5
PrivacyEntry          0xaFf6608e440799c669145997fC230d51404A5142
ShieldedSupplyPool    0x43c5Ba0B57b5fb99B09f34De89825335D82681f1
ShieldedPositionPool  0x2433D5ef60b0444A2830636e754417eA76C7FE87
LiquidationBoard      0xBB58b1457f6c486873FC85c42ED1380df475eff2
AssetRegistry         0x0D6097E8E5804Cd540D317B9A633AAB925d782A6
RateModel             0x32Db36d6FeDf7a1D4D0317C0AaD3b08B03eB8297
Oracle                0x852da28C9Bc35870eB01e2D49296b8c1E3204024
InsuranceFund         0xb53bfef209aCFD6Ae533B6aa72663bCf0e2861E0
tUSDC (faucet)        0xebb4B50494BFa79FF0B33ea927000aC48b0C2Fa1
tcbBTC (faucet)       0xc7845AF9A8262323602e7b6471ab600Cc4ce4d95
zkVerify proxy        0x3098A6974649478f0133046e44105AA84e868C21
```

Explorer: https://horizen-testnet.explorer.caldera.xyz

---

## Appendix B — Key Technical References

- zkVerify contract addresses: https://docs.zkverify.io/architecture/contract-addresses
- zkVerify proof submission via Kurier: https://docs.zkverify.io/overview/getting-started/kurier
- Noir language docs: https://noir-lang.org/docs
- UltraHonk proving system: https://aztec.network/blog/honk-proving-system
- Flashbots MEV research: https://writings.flashbots.net/quantifying-rev
- EIP-712 typed data: https://eips.ethereum.org/EIPS/eip-712
- Poseidon2 hash function: https://eprint.iacr.org/2023/323

---

*NoctFinance · August 2026 · Confidential — for grant and partnership discussions only*
