# Confidential Credit Network (CCN)

**The private prime brokerage for tokenized private credit.**

Investor Memo — June 2026
Pre-seed / Seed
Contact: zenfinance4144@gmail.com

---

## 1. The one-paragraph thesis

Apollo, BlackRock, Hamilton Lane and KKR have put **$14B+ of private credit on-chain** in 2026 via tokenized funds (ACRED, BUIDL, SCOPE, KKR feeders), and Securitize + RedStone have built the issuance and NAV-oracle rails. But every venue where these funds can be used as collateral — Morpho, Drift Institutional, Aave — is **fully public**: position size, leverage, and counterparty are visible to every competitor, MEV bot, and chain analytics firm. The Financial Stability Board's May 2026 report names valuation opacity and double-pledging as the #1 systemic risk in private credit, while borrowers and PE allocators **refuse to give up confidentiality**. The only architecture that satisfies both sides is **selective disclosure via zero-knowledge proofs**. CCN is the confidential collateral venue that closes the loop.

---

## 2. Why now — three converging forces

**(a) Institutional RWA went from pilot to product in 12 months.**
- Tokenized RWA TVL (ex-stablecoins) crossed **$31B in Q1 2026**, 4x year-on-year. Tokenized private credit alone is **$14B+**, the largest non-Treasury segment. [^rwa]
- BlackRock BUIDL: $2.5B AUM. Apollo ACRED: $100M+ and already collateral on Morpho and Drift. Hamilton Lane SCOPE and KKR feeders are live via Securitize. [^buidl]

**(b) Chainlink itself has named the gap in writing.**
- From the Chainlink article on onchain private lending: *"Institutions often cannot expose their loan book or sensitive borrower data on a public ledger."* [^cl-lending]
- Chainlink's answer is a **Privacy Standard** built on DECO + Blockchain Privacy Manager. These are **verification primitives, not a venue**. They prove things — they don't hold collateral or originate credit. The venue layer is open. [^cl-collateral]

**(c) The regulatory direction reversed.**
- US Treasury's 2026 report acknowledges **legitimate uses for crypto mixers and privacy tools** — a material thaw vs the 2022 Tornado posture. [^treasury]
- The EU AMLR's privacy-coin restrictions (effective July 2027) explicitly carve out **selective-disclosure protocols**. Aztec, Railgun PPOI, and similar are positioned as compliant; pure-anon protocols are not.
- The FSB's May 2026 report makes regulator demand for borrower-level disclosure structural and standing. **Selective disclosure is the regulatory ask, not just a marketing claim.** [^fsb]

---

## 3. The market

| Layer | Size | Status |
|---|---|---|
| Global private credit (TradFi) | **$1.7T today → $2.8T by 2028** (Apollo, S&P Global) | Reference market |
| Tokenized private credit on-chain | **$14B+** active loans, 8–15% APY | Growing fast |
| Tokenized RWA total (ex-stables) | **$31B** as of Q1 2026 | 4x YoY |
| Forecast 2026 TVL | **$100B** end-2026 (Centrifuge) | Trajectory consistent |

**Beachhead segment:** LPs in tokenized credit funds (ACRED, SCOPE, KKR feeders) who want to lever or unlock liquidity against their position without telegraphing it. Securitize's accredited-investor whitelist is the lead list — ~10,000 wallets, average ticket ≥$50k.

**Secondary segments:**
- DAO treasuries holding BUIDL who borrow stables for ops
- OCIO firms managing tokenized credit allocations on behalf of family offices
- Crypto-native funds (Coinbase Asset Management, Kraken — both ACRED investors)

---

## 4. The product

A confidential collateral and credit venue. Three product surfaces, one stack.

**(a) Confidential Collateral Vault.** Tokenized-fund tokens deposited into PrivacyEntry; user borrows USDC privately. Same UX as ACRED-on-Morpho today, but **position size, leverage, and counterparty are hidden**. Public observers see commitments and nullifiers, never amounts.

**(b) Proof-of-Non-Rehypothecation (PoNR).** Cryptographic proof, generated from the protocol's nullifier set, that a given collateral position has not been pledged elsewhere in CCN. Sold as a service to issuers (Securitize), fund admins, and LP auditors. **This is the direct answer to the Market Financial Solutions / Barclays double-pledging collapse cited by the FSB.** [^fsb]

**(c) Agent-Bounded Credit Lines.** ERC-4337 `AgentAccount` + on-chain `PolicyRegistry` enforce per-asset borrow caps, HF floors, and auditor visibility for OCIO bots and treasury operators. No competitor at the venue layer has bounded delegation as a primitive.

**Selective disclosure (cross-cutting):** every deposit can attach a Merkle tree of auditor keys — fund admin, LP, tax, regulator each provable independently. Borrower retains public confidentiality; **the right party can verify the right fact**.

---

## 5. Why this team / why this stack

**80% of the protocol is already built.** From June 1, 2026 progress:
- **180/180 Foundry tests passing** across 11 contracts (PrivacyEntry, ShieldedSupplyPool, ShieldedPositionPool, LiquidationBoard, AgentAccount, PolicyRegistry, AssetRegistry, Oracle, RateModel, InsuranceFund, ZkVerifier).
- **11 Noir circuits compiled and verified on testnet** (entry_deposit, supply_asset, borrow, repay, liquidate, etc.). 48/48 circuit tests.
- **Real bb.js browser proving** working end-to-end (Day 14c-E, June 2026).
- **Poseidon2 IMT** on BN254 (Day 14c) — verified, gas-tractable.

The pivot from "consumer privacy DeFi" → "institutional confidential credit venue" is **positioning + go-to-market + three contract additions**, not a rewrite. The technical pivot plan is in `CCN_TECHNICAL_PIVOT.md`.

---

## 6. Competitive map

| Layer | Incumbents | CCN position |
|---|---|---|
| Issuance + KYC wrapper | Securitize, Tokeny | **Partner / channel** |
| NAV oracle | RedStone, Chainlink | **Consumer** |
| Public collateral venue | Morpho, Drift, Aave, Maple, Centrifuge | **Complementary — we are the private venue** |
| Privacy chain | Aztec, Penumbra | **No conflict — they are chains, we are a venue. Long-term we deploy on Aztec too (circuits are already Noir).** |
| **Confidential collateral venue** | **— nobody —** | **CCN** |
| Agent rails | Base MCP, Binance Agent Kit, OKX | **Complementary — they are wallets, we are policy enforcement on credit** |

The combination — **confidential lending venue + tokenized RWA collateral + bounded agent delegation + selective disclosure** — is empty.

### Direct competitor risk

**Aztec.** Pre-mainnet L2 with confidential-token apps in the pipeline (Zaiffer, TokenOps, Bron, Raycash). They will ship a lending app on top eventually — but they are a chain stack, not a credit venue, and have no Securitize integration. We can ship 12–18 months ahead.

**Securitize building it themselves.** Mitigation: partner before they consider it. Offer revenue share on borrow volume. Securitize is an issuance + transfer agent business; a venue is a different muscle.

**Morpho / Drift adding privacy.** Both are public-by-design and would need a chain-level pivot. Unlikely in 24 months.

---

## 7. Defensibility

In increasing order of strength:

1. **Securitize integration as a Securitize-listed collateral venue.** A working integration is the first moat — the next entrant has to negotiate the same wrapper.
2. **The auditor / selective-disclosure dashboard.** Once a fund admin or an LP integrates CCN's auditor key into their reporting flow, switching cost is real engineering.
3. **The audit history.** ZK + Solidity audits at $230k–$410k per round are the same structural moat as in the consumer brief — but here the buyer (institutional credit) **actually pays for that credibility**.
4. **Policy registry network effect.** Every OCIO firm that writes a policy template on CCN makes the next one cheaper. Templates are the moat for the agent-bounded-credit wedge.

---

## 8. Revenue model

Standard credit-venue economics plus two SaaS layers:

- **Origination spread (core).** Reserve factor on borrow interest, 10–25% per asset. Maple comp: $4B+ AUM, 8–15% APY → meaningful spread revenue.
- **Origination fee.** 25–50 bps on line drawdown.
- **Liquidation bonus split.** 5% liquidator / 3% insurance fund (same as consumer brief).
- **Auditor-disclosure SaaS (high margin).** Monthly per-fund fee for the LP/regulator dashboard. Sticky.
- **Proof-of-Non-Rehypothecation (per-attestation).** Sold to issuers and fund admins as risk-management infra.

**Path to $5M ARR:** $500M TVL × 8% utilization × 1.5% protocol take = $6M/yr at steady state. With the SaaS layers we believe $250–300M TVL gets to $5M ARR.

---

## 9. Go-to-market: the institutional wedge

Three lanes, sequenced:

**Lane 1 — Securitize plug-in (months 0–6).**
List CCN as an alternative confidential collateral venue alongside Morpho/Drift on the Securitize Markets page. Marketing position: *"Borrow against your ACRED position without telegraphing your treasury strategy."* Acquire borrowers from Securitize's existing whitelist, not from cold start.

**Lane 2 — Fund-admin / LP auditor SaaS (months 3–9).**
Sell the selective-disclosure dashboard directly to fund admins (NAV Consulting, Apex Group, SS&C) and large LPs. The pitch: *"Cryptographic Proof-of-Non-Rehypothecation, MFS-collapse insurance, FSB-grade reporting from on-chain primitives."* This is a recurring SaaS line that doesn't require us to have huge TVL on day one.

**Lane 3 — OCIO / agent partnerships (months 6–12).**
Partner with one OCIO firm (e.g., a tokenized-credit-focused outsourced CIO) to build a reference Agent-Bounded Credit Line for family-office tokenized credit allocations. This is the wedge into the agent-DeFi narrative without competing with Base MCP at the wallet layer.

---

## 10. The ask

**$1.5M–$2.5M pre-seed / seed.**

Deployment over 8–12 months:

| Phase | Cost | Output |
|---|---|---|
| Q3 2026 — Technical pivot (AssetRegistry RWA support, RedStone adapter, Merkle-tree auditor keys, Base deployment) | $250k | Confidential collateral vault live on Base testnet, Securitize sandbox integration |
| Q3–Q4 2026 — Audits (Solidity + ZK) | $300k | 2 audit reports, bug bounty seeded |
| Q4 2026 — Securitize integration + first design partner | $200k | Listed on Securitize Markets, 1 LP design partner signed |
| Q1 2027 — Fund-admin SaaS pilot | $250k | 2 fund-admin pilots, auditor dashboard MVP |
| Q1–Q2 2027 — Phased mainnet (Base + Horizen) | $400k engineering + $100k bug bounty top-up | Cap-limited mainnet, $25M TVL target |
| Q2 2027 — Agent / OCIO design partner | $200k | 1 reference Agent-Bounded Credit Line deployment |

---

## 11. Risks — named honestly

| Risk | Mitigation |
|---|---|
| **Aztec ships a credit app** | 12–18 month lead. Circuits already in Noir, can port. Securitize integration is the real moat, not the chain. |
| **Securitize builds in-house** | Partner first. They are issuance, we are a venue — different P&L. Offer rev share. |
| **RWA regulatory clampdown** | Selective disclosure is the strongest regulatory posture in the category. Pure-anon protocols (Penumbra) cannot compete on this axis. |
| **NAV oracle stale or wrong** | Use RedStone (already serves ACRED/BUIDL/SCOPE). Do not build oracles. Add Chainlink as backup feed in Q2 2027. |
| **Anonymity-set bootstrap (consumer brief problem)** | **Does not apply at B2B scale.** Institutions need bilateral confidentiality from competitors, LPs, and chain analytics — not crowd anonymity. Five institutional users is a working privacy set. |
| **Smart-contract / ZK soundness bug** | Two independent ZK audits (Veridise + Zellic or Trail of Bits), differential fuzzing in CI, $50k bug bounty seed. Same posture as consumer brief; this segment pays for it. |
| **Horizen as settlement chain has low institutional liquidity** | **Pivot the settlement layer.** Deploy contracts on Base too — that's where ACRED/BUIDL live. Horizen becomes the privacy-aggregation rail, Base becomes the institutional venue chain. |

---

## 12. Why we will win

1. **The gap is real and named** by the dominant infrastructure player (Chainlink) and by the dominant regulator (FSB). The startup thesis is a direct response to their published statements.
2. **80% of the stack is already built** and tested at 180/180. The pivot is positioning and three contract additions — not a research effort.
3. **The market is named, on-chain, and reachable.** Securitize's whitelist is the lead list; ACRED/BUIDL/SCOPE holders are the beachhead. We do not need to create demand.
4. **The pricing tier exists.** Institutions pay for ZK audits, SaaS dashboards, and reporting tools. The revenue model has three layers (spread + SaaS + per-attestation), not just protocol fees.
5. **The defensible position compounds** with each integration (Securitize, fund admin, OCIO), each audit, and each policy template. Three years in, replicating CCN means replicating its audit history *and* its integrations *and* its policy library.

---

## 13. Next steps for an interested investor

1. **NDA + technical deep dive.** 90 minutes — walk through the existing 180-test Foundry suite, the 48-test Noir suite, the bb.js browser proving demo, and the three RWA-pivot contract additions.
2. **Reference calls.** Horizen team, zkVerify team, a Securitize ecosystem partner (we will introduce post-NDA), one private credit fund admin (in pipeline).
3. **Terms.** Equity or SAFE. Milestone-based tranching tied to the Q3 / Q4 / Q1 deliverables above.

---

## Footnotes

[^rwa]: FinanceFeeds, "Tokenized Private Credit in 2026: DeFi's $18B Breakout Moment"; Fensory RWA analysis Feb 2026; Centrifuge 2026 RWA predictions.
[^buidl]: The Block, "Tokenization firm Securitize taps RedStone as first oracle…"; Yahoo Finance, "RedStone exec explains how BlackRock and Apollo funds became DeFi collateral"; Ledger Insights, "Tokenized Apollo fund launched on 6 public blockchains."
[^cl-lending]: chain.link/article/onchain-private-lending. Quote: *"Institutions often cannot expose their loan book or sensitive borrower data on a public ledger."*
[^cl-collateral]: chain.link/article/onchain-collateral-management. Privacy Standard = DECO + CCIP Private Transactions, framed as verification primitives.
[^treasury]: US Treasury 2026 Report on Technologies Countering Illicit Finance Involving Digital Assets (Perkins Coie summary).
[^fsb]: Financial Stability Board, "Report on Vulnerabilities in Private Credit," 6 May 2026.

*Authoritative technical sources: `design-v2/` (17-subsystem design), `code/contracts/` (180-test Foundry suite), `code/circuits/` (11 Noir circuits, 48 tests), `code/dapp/` (Next.js + bb.js worker proving).*
