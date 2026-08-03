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

## 3. Horizen BD contact — ✅ DONE, reply received 2026-08-01

**Fradique (Horizen):** *"you don't need to…but we'd love to understand the integration
and see how we can support the beta. feel free to drop deets in the dev channel with
your docs and timeline."*

Reading: no permission gate, an explicit offer of support, and a request for a technical
post. This is the written interest the design doc's Premise 2 wanted. **Next action is
the dev-channel post below.** You have publicly committed to an **August beta on
Horizen** — the spike (run 2026-08-03) says that is technically achievable.

### Dev-channel post — ready to paste

> **zenfinance — privacy-preserving lending, integrating on Horizen testnet**
>
> gm — dropping technical details + timeline as suggested.
>
> **What it is:** an Aave-style money market where per-user positions are shielded.
> Supply, borrow, repay and liquidate work the usual way, but deposits, debts and
> collateral live as encrypted commitments. Protocol-level totals stay public so risk
> stays auditable; individual positions don't. Zero-knowledge proofs enforce
> health-factor and liquidity rules without revealing the numbers.
>
> **Why Horizen:** you have a DEX and private transfers, but no lending primitive.
> That's the gap we fill, and privacy-native L3 + cheap proof verification is exactly
> the environment this design needs.
>
> **Integration surface (what we actually touch on your chain):**
> • Standard EVM deploy — 11 Solidity contracts, no custom precompiles, no chain mods.
> • **zkVerify aggregation proxy** `0x3098A6974649478f0133046e44105AA84e868C21` —
>   our on-chain verifier consumes aggregated attestations through it. Already verified
>   it's live on testnet (ERC-1967, non-zero implementation). Same pattern we have
>   working end-to-end on Base Sepolia today.
> • **ERC-4337** — confirmed canonical EntryPoint v0.7 (`0x…032`) is deployed on
>   testnet. Agent accounts execute under user-signed spending policies.
> • Proving runs **in the user's browser** (Noir + bb.js, UltraHonk) — no prover
>   servers, no custody of secrets.
>
> **State of the build:** 224/224 contract tests green including solvency invariants,
> 11 circuits compiled with pinned verification keys, full deposit→borrow loop working
> locally, and encrypted note persistence with signature-only recovery (wipe your
> browser, sign once, positions come back).
>
> **Timeline:**
> • **August — testnet beta on Horizen:** deploy + public demo (deposit → shielded
>   borrow), waitlist, funnel metrics we're happy to share with your team.
> • **After that — audit.** We won't touch mainnet before a security audit; we're
>   scoping quotes now. That's the honest gate on a mainnet date.
>
> **Where support would help most:** (1) visibility for the testnet beta, (2) intros to
> larger holders who'd give feedback on private borrowing, (3) anything on the grant
> side — we're applying to Thrive.
>
> Repo: https://github.com/danielx2d4144/zenfinance_privacy
> Site: <paste your Vercel URL>
>
> Happy to walk anyone through the circuits or the deposit flow live.

**Before posting:** deploy to Horizen testnet if you can (makes the post far stronger —
"it's live at 0x…"), or post now and follow up with the address. Ask Claude to "run the
M3 deploy" when you're ready.

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
