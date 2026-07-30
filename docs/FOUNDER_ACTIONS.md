# Founder Action Pack — Track 2 (gates M3)

Created 2026-07-30, the day M2 closed. These four items are the critical path.
M3 (Horizen testnet demo) does NOT start until #1 is SUBMITTED and #2 has 5 calls BOOKED.

---

## 1. Thrive application (horizen.thrive.xyz) — submit this week

Draft answers (adjust voice, keep the facts — every claim below is verifiable in the repo):

- **Project:** ZenFinance — a privacy-preserving lending protocol. Deposit, supply,
  borrow, and repay without your positions, balances, or liquidation levels being
  public. Shielded-pool architecture (commitments + nullifiers), zk-proofs verified
  on-chain via zkVerify aggregation.
- **What's built (working code, not a deck):** 11 Solidity contracts with 224 passing
  tests including solvency invariants; 11 Noir circuits (Poseidon2/BN254) with pinned
  verification keys; in-browser proving (bb.js web worker); full deposit→borrow loop
  running against a local chain; zkVerify/Kurier attestation verified end-to-end on
  Base Sepolia; encrypted note persistence with signature-only recovery (shipped this
  week — the Zcash/Aztec memo pattern, adapted for lending).
- **Why Horizen:** Horizen 2.0 is a privacy-first L3 with a DEX (DarkSwap) and private
  transfers (Tachyon) but NO lending protocol. Lending is the largest DeFi category;
  a privacy-native money market is the missing primitive. We're Horizen-ready:
  chain config for testnet 845320009 is already in the codebase.
- **Ask:** grant support toward (a) Horizen testnet deployment + public demo,
  (b) security audit funding (quotes in progress — the real gate to mainnet).
- **Milestones we'd commit to:** testnet demo with waitlist within weeks of grant;
  funnel metrics shared (wallet_connected → deposit_confirmed → prove_completed).
- **Team:** solo technical founder, full-stack (contracts, circuits, dapp, infra).

## 2. Mom-Test calls — book 5, run within 2 weeks

**Target profile:** people who currently borrow ≥$10k against crypto (Aave/Compound/
Morpho users, or CEX-loan users), OR chose a CEX loan specifically to avoid on-chain
visibility. Find them in: lending-protocol Discords, DeFi Twitter/Farcaster, your own
network, Horizen/DarkSwap community (BD contact can intro — see #3).

**Script (past behavior only — never "would you use..."):**
1. "Walk me through the last time you borrowed against your crypto. What did you use, how much, why that venue?"
2. "Has anyone ever traced or called out one of your on-chain positions? What happened?"
3. "Have you ever done anything specifically to hide a position — split wallets, CEX loan, OTC? What did it cost you?"
4. "What almost made you not take that loan?"
5. "When your position got close to liquidation, who could see it?"

**Gate 2 scoring (design doc):** a call counts as CONCRETE PAIN only if they describe
a real past action taken because of position visibility (paid CEX spread, split
wallets, avoided borrowing, got hunted near liquidation). ≥2/5 concrete = consumer
wedge lives. 0-1/5 = wedge is dead → whale-first only or pause (honor it like Gate 1).

## 3. Horizen BD contact — one message

Goal: convert interest into something written + intros. Send:

> "ZenFinance update: the privacy lending stack is code-complete through note
> persistence — 224 contract tests, 11 circuits, in-browser proving, and
> signature-only balance recovery shipped this week. Two asks: (1) we're submitting
> to Thrive — can you flag it internally? (2) can you intro me to 2-3 of the larger
> ZEN/Horizen holders for a 20-min feedback call on private borrowing? Happy to demo
> the deposit→borrow flow live."

Log the reply verbatim — a written "we want this on Horizen" is Gate-relevant evidence.

## 4. Audit scoping quotes — start now (weeks of lead time)

Email 2-3 of (zk-competent firms): **Zellic, Veridise, Trail of Bits, Nethermind
Security, Spearbit/Cantina, ABDK.** Template:

> "Requesting an audit scoping estimate: Solidity lending protocol (11 contracts,
> ~X kLOC, shielded-pool architecture, 224 tests incl. invariants) + 11 Noir
> circuits (Poseidon2/BN254, UltraHonk via bb.js), zkVerify aggregation for
> on-chain verification. Timeline: scoping now, audit after testnet hardening.
> Can you share rough cost band, lead time, and whether you cover both the
> Solidity and Noir sides?"

Budget planning band from the design doc: $230k–$410k total. Gate 3: NO mainnet
without audit funding secured. Quotes make the Thrive/grant ask concrete.

---

## When #1 is submitted and #2 has 5 bookings → tell Claude "start M3"
M3 opens with the 1-day spike (4-point gate incl. zkVerify proxy on Horizen
testnet; any FAIL → demo ships on Base Sepolia, pitch says "Horizen-ready").
