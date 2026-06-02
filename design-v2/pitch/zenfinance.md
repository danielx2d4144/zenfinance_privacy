# Zenfinance

**Private, agent-native lending for the on-chain economy.**

> Investor pitch deck — seed round.
> 12 slides. Convert with Marp / Slidev / Pandoc.
> Brand: lowercase logotype `zenfinance`, prose capitalisation `Zenfinance`.

---

## 1 — Cover

# zenfinance

**Lend and borrow on-chain — without broadcasting your balance sheet.**

A privacy-preserving multi-asset money market on Horizen.
Built for humans, optimised for AI agents.

— [contact / website / date]

---

## 2 — The problem

Every position in DeFi credit is **public**.

- Aave, Morpho, Spark expose every supply, borrow, and liquidation level on chain.
- **Whales get front-run**: liquidation bots watch their LTV in real-time.
- **Funds and treasuries can't use DeFi credit** — their positions are their strategy.
- **Compliant institutions can't onboard** — public exposure violates internal data policies.

DeFi credit grew to ~$25B TVL with this constraint. The next leg of growth comes from the users it currently locks out.

---

## 3 — The solution

**Same Aave-style market. Encrypted per-user state.**

- Supply, borrow, repay, liquidate — same UX, same APY mechanics.
- Per-user amounts live as **encrypted commitments**; protocol-level totals stay public so risk is auditable.
- Zero-knowledge proofs verify every operation respects health-factor and liquidity rules — without revealing the numbers.
- **Optional auditor-decryption** at deposit time for users who need a compliance trail.
- **First-class AI agent support** — every operation is callable by an ERC-4337 agent under a user-signed spending policy.

---

## 4 — Why now (the unlock)

Four pieces matured in the same window. None of them existed together a year ago.

| Piece | Status |
|---|---|
| **Horizen mainnet on Base** | Live (privacy-native L3, low fees, EVM) |
| **zkVerify mainnet** | Live (cheap proof aggregation, ~$0.01/op amortised) |
| **Noir ≥ 1.0** | Stable toolchain for production ZK circuits |
| **ERC-4337 v0.7** | Smart accounts + delegated keys + on-chain policy |

Zenfinance is the first lending protocol designed from day one around all four.

---

## 5 — How it works (one slide)

```
   user wallet                 prover (browser or server)
       │                              │
       │  sign once → spending key    │ Noir circuit + witness
       ▼                              ▼
  ┌─────────────┐         ┌──────────────────────┐
  │ AgentAccount│         │  UltraHonk proof      │
  │  (ERC-4337) │         └─────────┬────────────┘
  └──────┬──────┘                   │ submit
         │ userOp                   ▼
         ▼                  ┌────────────────┐
  ┌─────────────┐           │  zkVerify      │  aggregates
  │  Pool       │◀──────────│  + Kurier      │  across users
  │  contract   │  receipt  └────────┬───────┘
  └─────────────┘                    │
        │                            ▼
        ▼                   one verification
   note commitments         on destination chain
   + nullifiers
```

Eleven Noir circuits cover the full lifecycle. One on-chain verification per **aggregated batch** of users.

---

## 6 — Product surface

Three first-class clients, **one contract surface**.

- **Human dapp** — Next.js, wallet-connect, browser-side proving via `bb.js`.
- **TypeScript & Python SDKs** — for treasury bots, funds, automated strategies.
- **MCP server** — Claude, ChatGPT, and other agents can hold delegated keys and operate positions under a user-signed policy with per-asset budgets and TTLs.

Agents don't get the user's spending key — they get a session key with policy guardrails enforced on-chain.

---

## 7 — Technical moat

What's hard to copy:

1. **Aave-aligned solvency invariants under encryption.** Provable health-factor, provable accrual, provable bad-debt socialisation — without revealing balances. Designed against a formal threat model (`S15`).
2. **Identical leaf-recipe** between circuit and contract — pinned `vkHash` at deployment makes silent mismatches impossible.
3. **No proxies, no upgrades.** v1 ships immutable. Trust is in the code, not in the multisig.
4. **Reproducible builds.** Every deployed bytecode traces to a pinned Docker image and circuit commit. Audit-grade supply chain from day one.
5. **Designed for agents.** Most lending protocols bolt on bots; Zenfinance ships an MCP server, policy registry, and 4337 account in the core release.

---

## 8 — Market

| Segment | Reference | Estimated Zenfinance TAM |
|---|---|---|
| **DeFi credit TVL** | Aave $20B + Morpho $3B + Spark $2B + others | ~$25B today |
| **Whale segment** (positions >$1M) | ~15% of DeFi credit | ~$3.75B |
| **Fund / treasury / institutional** | <2% on-chain today | unbounded — gated by privacy |
| **Agent-driven volume** | <0.1% of DeFi today | projected 5–15% by 2027 |

We don't need to compete with Aave for retail. We need the slice that **won't** use Aave because of disclosure risk.

---

## 9 — Competitive landscape

| | Private | Lending | EVM | Agent-native |
|---|---|---|---|---|
| Aave / Morpho / Spark | ✗ | ✓ | ✓ | ✗ |
| Aztec (defunct L2) | ✓ | ✗ | partial | ✗ |
| Penumbra | ✓ | partial | ✗ (Cosmos) | ✗ |
| Railgun | ✓ | ✗ (shielding only) | ✓ | ✗ |
| **Zenfinance** | **✓** | **✓** | **✓** | **✓** |

Closest neighbour is "Aave + Aztec," and Aztec exited the chain business. The intersection is empty.

---

## 10 — Business model

The protocol earns from three streams. All are configured per-asset by governance.

1. **Reserve factor** on borrow interest — 5–30% of paid interest accrues to the protocol (industry standard).
2. **Liquidation incentive split** — a fixed slice of every liquidation bonus.
3. **Agent operation surcharge** (optional) — applied to MCP/SDK-routed userOps, not to direct human txs.

Revenue scales with utilisation, not with marketing spend. At Aave's $20B TVL and ~60% utilisation, a 15% reserve factor on a 5% borrow APR produces ~$90M/yr to the protocol. Zenfinance needs ~$200M TVL to be self-sustaining; ~$2B TVL to be a category leader.

---

## 11 — Where we are

**Day 8 of a 21-day v1 build, on schedule.**

- ✓ 11 Noir circuits compiled, verified, vkHashes pinned on-chain
- ✓ Core contracts (Pool, Entry, Verifier, RateModel, Oracle, InsuranceFund) — 186 tests passing
- ✓ ERC-4337 AgentAccount + PolicyRegistry — integration tests green
- ✓ Caldera L3 testnet deployment confirmed
- ◻ Day 8–14: attestation pipeline, keepers, subgraph, backend
- ◻ Day 15–21: dapp, SDKs, MCP server, audit prep, testnet launch
- ◻ Q3: audit + mainnet candidate
- ◻ Q4: mainnet, agent SDK GA

Three external audits scoped. No proxy contracts. No admin keys with fund-movement authority.

---

## 12 — Ask

We are raising a **[$ amount] seed** to:

- Complete the v1 build and external audits.
- Stand up the insurance fund and seed initial liquidity.
- Hire two senior protocol engineers and one DevRel.
- Launch the agent ecosystem programme (grants for TS/Python/MCP integrations).

**What we want from partners:**
- Capital-efficient liquidity providers comfortable with novel risk frameworks.
- Auditor and security partners (Trail of Bits, Spearbit, OpenZeppelin tier).
- Anchor agent integrations — funds and protocols whose strategies require privacy.

— Contact: [email]
— Repo / data room: [link]
