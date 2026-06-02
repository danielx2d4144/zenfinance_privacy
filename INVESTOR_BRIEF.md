# A Privacy-Preserving, Agent-Native Lending Protocol on Horizen

**Investor Brief — June 2026**

---

## 1. Executive summary

We are building a **privacy-preserving multi-asset lending protocol** that lets users (and AI agents acting on their behalf) supply, borrow, repay, and liquidate digital assets — **without exposing position sizes, balances, or transaction history** to the public blockchain.

In one sentence, the product is **Aave's lending model, with Tornado-Nova's privacy mechanics, with Claude / GPT / autonomous agents as first-class users**, built on **Horizen** (an L3 rollup) with proof verification through **zkVerify** (a dedicated proof-aggregation chain).

Three things make this protocol differentiated:

1. **Real privacy, not pseudonymity.** Position sizes, debts, collateral, and the link between wallet addresses and positions are hidden by zero-knowledge proofs. The chain sees only commitments and nullifiers — not amounts.
2. **Agent-native from day one.** Most DeFi protocols assume a human in a browser. We expose the protocol through an **MCP (Model Context Protocol) server** and a typed REST API, with **ERC-4337 smart accounts** enforcing owner-defined spending policies. An LLM-driven treasury operator can run on this protocol with a 30-line config.
3. **Compliance-ready, not anonymity-maximalist.** Users can optionally attach an auditor key to each deposit — the same opt-in compliance pattern that has survived legal scrutiny in jurisdictions that sanctioned non-opt-in privacy tools.

The protocol is **designed, partially implemented, and on a 21-day path to testnet feature-completeness**. As of June 1, 2026, **7 of 21 build days are complete**: every core smart contract is written and unit-tested, every ZK circuit is compiled and verified, and the integration tests run green (180/180 Foundry tests, 48/48 circuit tests). The work remaining is integration with external services (proof relayer, oracle, indexer), the user-facing dApp, the agent SDKs, and audit hardening.

We estimate **8–12 months to audited mainnet** with a working capital need of **$1.2M–$2.2M** covering engineering, five audits (Solidity, ZK, cryptography, infrastructure, legal), an accessibility audit, a bug bounty seed pool, and operational infrastructure.

---

## 2. The problem we are solving

### 2.1 Transparent DeFi punishes its best users

In current DeFi (Aave, Compound, Morpho, etc.), every lending position is fully public. Anyone with a block explorer can see:

- How much capital each wallet holds
- What collateral each borrower has posted
- What their health factor is
- The exact price at which they will be liquidated

This transparency creates four real, repeating problems:

| Problem | Who it harms | What it looks like |
|---|---|---|
| **Front-running and sandwich attacks** | Whales, large traders | Professional MEV bots see a large transaction landing and extract value around it |
| **Treasury surveillance** | DAOs, family offices, OTC desks | Competitors and counterparties observe working capital, runway, and rebalancing |
| **Phishing based on holdings** | High-net-worth retail | Attackers target wallets in proportion to their visible balances |
| **Liquidation predation** | Borrowers in volatile markets | Sophisticated bots out-race ordinary users to liquidate positions for the bonus |

The crypto-native answer to this — Tornado Cash and similar mixers — solved one transaction at a time and ran into severe legal headwinds. What the market needs is a **functional financial product** (lending) that is private by construction, with an **optional compliance channel** so that the legitimate users who want to verify their activity to a regulator or auditor can do so without exposing themselves to the public.

### 2.2 DeFi was built for browsers, but agents are coming

The category of "AI agents that manage capital" has crossed from theory into product. Treasury automation, algorithmic rebalancing, custodial-tech-as-a-service, and liquidator bots are all software clients that need to operate DeFi without a human in the loop.

Today, every protocol that an agent uses requires:

- Custom client code for each protocol
- A wallet that the agent fully controls (no bounded delegation)
- Manual policy enforcement, often outside the chain

None of the major lending protocols expose a typed tool catalogue or a bounded-delegation primitive. **MCP** — the open protocol that LLM agents already use to discover and call tools — is unsupported by every major DeFi protocol. We see this as an addressable gap, not a nice-to-have.

---

## 3. The product

### 3.1 What a human user sees

A user holding USDC opens the dApp in any modern browser, connects MetaMask (or Coinbase Wallet, WalletConnect, SubWallet), and is presented with a familiar lending interface — supply, borrow, repay, withdraw, with current rates and their personal positions.

Three things differ from Aave / Compound:

1. **A one-time `Deposit` step funds a "private balance."** This is the only time the user's wallet address touches the protocol. From that moment on, every action — supply, borrow, repay, liquidate, withdraw collateral — happens inside the privacy layer, invisible to external chain observers.
2. **A ~3-to-5-minute confirmation window per action.** Each action requires a zero-knowledge proof, which is generated locally in the browser, then aggregated by zkVerify into a batched proof, then posted to Horizen. The user sees a progress bar; nothing in the UX surprises them.
3. **A final `Withdraw` step to send funds back out** to any external address. This is the only other public footprint on the user's wallet.

Between the deposit and the withdraw, the user can do an unlimited number of operations across up to four assets, with **none of the activity visible on-chain in a way that links back to their identity**.

### 3.2 What an AI agent sees

The same protocol is exposed through:

- A **typed REST API** (OpenAPI 3.1) for traditional bots
- An **MCP server** — the Model Context Protocol that LLMs use to discover and invoke tools — so that Claude, GPT-4, Gemini, etc. can call the protocol with no glue code
- An **ERC-4337 smart account** (`AgentAccount`) that an owner deploys once and delegates a session key to the agent
- A **policy registry** where the owner declares, on-chain, what the agent is and isn't allowed to do: per-asset spending caps, per-asset health-factor floors, expiry times, allowed operations

An owner can write a one-paragraph policy like:

> *Agent X may deposit and withdraw up to $500,000 of USDC. It may borrow up to $200,000. It must keep my account's health factor above 2.0 at all times. The session expires on December 31. I can revoke this in one click.*

…and the **smart account itself**, on-chain, enforces every clause. The agent literally cannot exceed the policy; the contract reverts.

### 3.3 What a liquidator sees

Liquidation is the part of any lending protocol most disrupted by privacy. We solved this with a **public per-position liquidation price** — a number that says "this position becomes liquidatable when the price of its collateral drops below X." Liquidation prices are public; the underlying position sizes are not.

Any human or agent can scan the **LiquidationBoard** contract for positions whose liquidation price has been crossed by the current oracle price, claim them, and earn the liquidation bonus (5% to the liquidator, 3% to the insurance fund). Because the protocol's aggregation latency creates a ~3–5 minute grace period, **borrowers get a real chance to rescue their own position** before a liquidator settles — a borrower-friendly side effect of the privacy architecture.

We additionally operate a **protocol-funded backstop liquidator** so that, even in low-volume periods, no bad debt accumulates because no third party showed up.

### 3.4 What v1 actually ships

**Two markets at launch:** USDC and cbBTC (Coinbase-wrapped BTC).
**Two more markets via governance after launch:** WETH and ZEN (the native asset of Horizen).
The **multi-asset architecture is in place from day one** — adding markets is a parameter change executed by the admin Safe, not a contract redeploy.

**Conservative parameters:** 60% loan-to-value at origination, 75% liquidation threshold, 10% liquidation bonus. These are tighter than Aave's because we accept ~3–5 minutes of liquidation latency, where Aave settles per-block.

**One protocol, one chain, no cross-chain in v1.** Horizen for settlement, zkVerify for proof aggregation. Cross-chain comes later.

---

## 4. The technology

### 4.1 Stack at a glance

| Layer | Technology | Why |
|---|---|---|
| Settlement chain | **Horizen** (Caldera L3 on Base Sepolia, chain id 2651420) | EVM-compatible, lower fees than Base mainnet, the chain the project is being built on with active backing |
| Proof aggregation | **zkVerify** (Volta testnet) | Dedicated chain for aggregating many ZK proofs into one on-chain verification — orders of magnitude cheaper than verifying each proof natively on Horizen |
| Proof system | **UltraHonk** via Noir + Barretenberg | Modern, transparent (no trusted setup), browser-friendly via WASM, supported by zkVerify |
| Smart contracts | **Solidity 0.8.27**, Foundry, OpenZeppelin v5 | Standard, audited primitives |
| Smart accounts | **ERC-4337 v0.7** | Industry standard for account abstraction; canonical EntryPoint already deployed on Horizen testnet |
| Frontend | **Next.js 14**, browser proving in a Web Worker | Mainstream stack so any frontend engineer can contribute |
| Indexer | **Goldsky subgraph + Postgres** | Standard, supported provider |
| Oracle | **Stork** | Push-and-pull oracle already operational on Horizen |
| Agent integration | **MCP** (Model Context Protocol) + typed REST + Python SDK + TS SDK | Native LLM discoverability + traditional bot support |

Every component on that list is **production-ready today** on Horizen testnet. There is no "we are waiting for technology X to ship" dependency anywhere in the architecture.

### 4.2 Where privacy actually comes from

The privacy mechanism is the most technically delicate part of the protocol. Two summaries — one short, one deeper — for different reader contexts.

**Short:** every user's holdings are represented as **encrypted "notes"** that only the user can decrypt. Operations on those notes (supplying, borrowing, repaying) are proved correct via zero-knowledge proofs. The chain stores **commitments** (cryptographic fingerprints of notes) and **nullifiers** (one-time-use markers that prevent double-spending) — never the amounts themselves. A user's wallet address only appears on-chain at the very first deposit and the very last withdrawal.

**Deeper:** the design extends the **Tornado-Nova / Aztec Connect** shielded-pool model into a multi-asset lending market. Each user's funds become a balance commitment inside `PrivacyEntry`, an account contract that holds the actual ERC-20 reserves. Every operation (supply, borrow, repay) burns one balance commitment via its nullifier and creates a new one via a Pedersen commitment, with a Noir circuit proving the arithmetic was done correctly. The dApp generates that proof locally in the browser (or on a server, for agents and weak devices), submits it to **zkVerify** for aggregation with other users' proofs, and the resulting batched proof is posted on Horizen for a one-shot verification that settles dozens or hundreds of user operations at once.

This is the same security model that Aztec Connect ran on Ethereum mainnet from 2022 onward. We have inherited their cryptographic choices and extended the application logic to support multi-asset positions with liquidation (which Aztec Connect did not support).

### 4.3 What we are not relying on

We deliberately are **not** using:

- **Trusted execution environments** (Intel SGX, AWS Nitro Enclaves) — earlier iterations of this design depended on a TEE-based confidentiality layer. We pivoted away because TEEs require trusting hardware vendors and create production complexity that is not yet solved at our scale.
- **Trusted-setup ceremonies** — UltraHonk is transparent.
- **Bridges** — assets are bridged to Horizen by LayerZero before they reach us; we treat them as native ERC-20 from there on.
- **A custom L1 or app-chain** — we deploy on an existing chain, with an existing proof-aggregation chain. No new sovereignty to defend.

Every architectural risk we accept is **bounded** to a known, audited primitive.

### 4.4 The honest tradeoff

We are **not the fastest lending protocol**. Aave on Base settles in one block (~2 seconds). We settle in ~3–7 minutes because of proof aggregation latency.

**This is the cost of privacy** and it is the only meaningful UX downside. We have a public roadmap (Subsystem 16 of our design docs) of five interventions that can compress this further: running our own aggregation domain (-1 to -3 min), offering an instant direct-verification tier for users who pay a premium, server-assisted proving for weak devices, pre-generated proofs for predictable flows, and optimized circuits. None of those are required for v1; they are the v1.5 / v2 roadmap.

For our target users — privacy-conscious DeFi natives, treasury operators, OTC desks, high-net-worth individuals, agent-driven automation — the tradeoff is plainly worth it. For pure retail traders who care only about speed, we are not the right product.

---

## 5. Why this team / why now

### 5.1 Why now

Four things make this product buildable in 2026 that were not true in 2024:

1. **zkVerify is live on testnet** with a working aggregation domain and a documented REST relayer (Kurier). Without this, every proof would have to be verified individually on the settlement chain — an order of magnitude more expensive.
2. **Horizen is live on testnet** with a canonical ERC-4337 EntryPoint already deployed, an active oracle (Stork), and standard infrastructure providers (Goldsky, Pinata, Safe-via-Den).
3. **MCP has been adopted by every major LLM provider** (Anthropic, OpenAI, Google) as the standard tool-discovery protocol. Building agent-native infrastructure now is timing the adoption curve correctly.
4. **The reference implementations exist.** JetHalo, the same team building Horizen tooling, has published three reference dApps (`zk-Escrow`, `zkp2p-demo`, `zkvote`) using the exact same Horizen + zkVerify + UltraHonk stack. Our protocol is more ambitious in scope, but every individual primitive we use has been proven on testnet.

### 5.2 What we have built so far

As of June 1, 2026, we have completed **Days 1–7 of a 21-day implementation roadmap**, working from a complete 17-subsystem design specification. Concretely:

**Smart contracts (Days 1–3 + Day 7) — all written, all tested, 180/180 Foundry tests passing:**

- `AssetRegistry.sol` — per-asset configuration (LTV, liquidation threshold, reserve factor)
- `Oracle.sol` — Stork price wrapper with staleness checks
- `RateModel.sol` — kinked supply/borrow rate curve with index accrual (Aave v3 model)
- `PrivacyEntry.sol` — the custody contract; holds all user reserves, exposes only commitment-tree operations to external observers
- `InsuranceFund.sol` — per-asset bad-debt reserves
- `ZkVerifier.sol` — per-circuit verifying-key registry, replay protection
- `ShieldedSupplyPool.sol`, `ShieldedPositionPool.sol`, `LiquidationBoard.sol` — the lending logic on top of the privacy layer
- `AgentAccount.sol` — ERC-4337 v0.7 smart account, enforces policies before forwarding to protocol contracts
- `PolicyRegistry.sol` — owner-signed per-asset policies, on-chain enforcement

**ZK circuits (Days 4–5) — all 11 circuits compiled, verified on testnet, vkHashes pinned in deployment scripts:**

`entry_deposit`, `entry_withdraw`, `supply_asset`, `withdraw_supply`, `deposit_collateral`, `withdraw_collateral`, `borrow`, `repay`, `liquidate`, `consolidate_balance`, `compute_triggers`

48 hand-crafted circuit tests cover happy and adversarial paths. All circuits compile within constraint budget (≤15k constraints, the limit for acceptable browser proving time).

**Integration (Day 6):** the full deposit → supply → borrow → repay → withdraw loop runs end-to-end against the contracts with mock proofs, custody balanced to the wei at every step. Replay defences (nullifier reuse, vkHash mismatch, aggregation-tuple reuse) all reject.

### 5.3 What remains

**Days 8–21** of the build, which cover:

- Wiring up the real proof relayer (Kurier) and exercising the full Noir → zkVerify → Horizen path with real proofs (Day 8)
- Oracle keepers + interest accrual keepers + backstop liquidator (Day 9)
- Subgraph + REST API + MCP server (Days 10–12)
- Next.js dApp with browser proving in a Web Worker (Days 13–15)
- Agent SDKs in TypeScript and Python with reference examples (Day 16)
- Encrypted note storage with optional IPFS backup (Day 17)
- Governance Safe and admin runbooks (Day 18)
- Reproducible builds and artifact distribution (Day 19)
- Server-assisted proving for mobile and low-spec devices (Day 20)
- Final integration testing and a release-candidate report (Day 21)

After Day 21, the protocol is **testnet feature-complete**. From there, the work is **audits, bug bounty, accessibility audit, phased mainnet rollout** — which we estimate adds 6–9 months and the bulk of the budget.

---

## 6. The market and the moat

### 6.1 Who buys this

Five primary human-user segments, two primary agent-user segments. From our design's project overview:

**Human users:**

1. **Privacy-conscious DeFi natives** — already on Aave or Compound; would prefer the same protocol with privacy.
2. **Treasury operators (DAOs, family offices)** — need to borrow operating capital without revealing treasury size to competitors and counterparties.
3. **OTC desks** — want private credit lines for short-term capital flexibility.
4. **High-net-worth individuals** — don't want their on-chain net worth to be a public dataset for kidnappers, tax planning leakers, or phishers.
5. **Users in jurisdictions with active chain analysis** — for them, privacy is not paranoia.

**Agent users:**

1. **LLM-driven treasury automation** — owner sets a policy, agent executes within bounds.
2. **Liquidator bots** — built-in incentives plus a native MCP catalogue make a liquidator agent ~100 lines of code.

### 6.2 The competitive landscape

| Protocol | Privacy | Multi-asset | Agent-native | Live |
|---|---|---|---|---|
| **Aave / Compound / Morpho** | None | Yes | No | Yes |
| **Tornado-style mixers** | Strong | No (not lending) | No | Yes (with legal exposure) |
| **Aztec Connect** (sunset 2024) | Strong | Limited | No | No |
| **Penumbra** | Strong | Yes (DEX/staking) | No | Yes (no lending) |
| **Railgun** | Strong | No (not lending) | No | Yes |
| **Our protocol** | Strong | Yes | **Yes** | In build |

The combination — **privacy + multi-asset lending + native agent support** — is unoccupied. The closest comparable (Aztec Connect) was sunset in 2024 and never supported lending. The privacy DEX category (Penumbra, Railgun) has no lending product. The agent-DeFi category (everyone) has no privacy.

### 6.3 The moat

Three durable advantages, in increasing order of strength:

1. **The product is the moat (weak).** Whoever builds the first credible privacy-and-agent lending protocol gets the brand recognition, the integrations, the audit history.
2. **The agent ecosystem is the moat (medium).** Once an agent vendor (an autonomous-treasury startup, a custodial-tech-as-a-service provider) integrates our MCP server, the switching cost to a competitor is real engineering work. Every additional integrating partner widens the moat.
3. **The audit history is the moat (strong).** Privacy protocols require ZK audits, which are scarce and expensive. Once we have completed five audits and a year of bug bounty without a critical finding, **the cost to a copycat to replicate our credibility is the same audit cost we paid** — plus the time. This is a structural barrier.

---

## 7. The financial plan

### 7.1 Budget to audited mainnet

From our design documentation:

| Category | Cost |
|---|---|
| Engineering (4–6 engineers × 10 months) | **$800k–$1.5M** |
| Audits — 5 firms (Solidity, ZK, Crypto, Infrastructure, Legal) | **$230k–$410k** |
| Bug bounty seed pool | **$50k** |
| Infrastructure (AWS, Goldsky, Pinata) | **$5k–$10k / month operational** |
| Legal counsel | **$30k–$60k** |
| Accessibility audit (Deque or equivalent, WCAG 2.1 AA) | **$10k–$15k** |
| **Total to audited mainnet** | **~$1.2M–$2.2M** |

### 7.2 Revenue model

Standard lending-protocol economics, taken directly from Aave v3:

- **Reserve factor** on borrow interest — a configurable percentage (10–25% depending on asset) of interest paid by borrowers accrues to the protocol's `InsuranceFund`.
- **Liquidation bonus split** — of every liquidation, 5% goes to the liquidator (incentive) and 3% goes to the `InsuranceFund` (protocol revenue).
- **Protocol fee on aggregation premium tier** (post-v1) — users who want instant on-chain verification instead of aggregated verification pay a small premium that accrues to the protocol.

Revenue scales linearly with TVL and utilization. The launch goal is **$1M TVL in the first 30 days** (our anonymity-set floor — below this, the privacy guarantees weaken because the user set is too small).

### 7.3 Token strategy (deliberately deferred)

**No governance token in v1.** Protocol admin is a 3-of-5 hardware-wallet Safe via Den, the standard tooling for Horizen multisigs. A token may make sense in v1.5+, **but only after the product has shipped, been audited, and reached the anonymity-set floor**. Premature tokenisation invites speculation that distracts from the security-first launch.

---

## 8. Risks and how we have planned for them

We have a **17-subsystem design document** that includes an explicit threat-model subsystem mapping every identified threat to a concrete mitigation, an owning subsystem, and an audit-verifiable criterion. The headline risks are:

| Risk | Mitigation |
|---|---|
| **ZK circuit soundness bug** (could allow invalid proofs) | Two independent ZK audits (Veridise + Zellic / Trail of Bits), per-circuit adversarial review, differential fuzzing in CI. ZK audits are the single largest line item in the audit budget for this reason. |
| **Smart contract exploit** | Solidity audit by Cantina + Halborn (or equivalent), 4–6 weeks. All admin functions gated on the 3-of-5 Safe; no EOA holds admin rights. |
| **Cold-start anonymity set** | At launch with <100 users, positions are de facto identifiable. We plan founder/treasury seeding of the pool to bootstrap the anonymity set, plus a phased rollout that does not advertise externally until the floor is met. |
| **Browser prove time on the borrow circuit** | Benchmark is ≤15s on a 2022 mid-spec laptop; for weaker devices, we ship a **server-assisted proving** mode where the server computes the proof from a witness the user constructs. The witness never leaves the user's device until it is wrapped for the prover. v1.5 adds a TEE-based prover for users who want the speed without the trust assumption. |
| **Regulatory exposure of a privacy protocol** | **Auditor opt-in per deposit** — the same pattern that survived legal scrutiny when non-opt-in privacy tools did not. Legal audit is part of our pre-mainnet checklist. |
| **External service dependency (Kurier, Stork, Goldsky)** | Each has a documented fallback (zkVerifyJS for Kurier outage, multiple oracle providers reviewed, multiple subgraph providers reviewed). |
| **Liquidation latency creates a borrower-favourable grace period** | This is by design and is documented to lenders. Conservative parameters (60% LTV vs Aave's 75–80%) compensate. |

The full threat model lives in `design-v2/subsystems/15_threat_model.md` and is available to investors under NDA.

---

## 9. The ask

We are seeking **$1.5M–$2.5M** to take the protocol from current build status (Day 7 of 21) to audited mainnet over the next **8–12 months**.

A typical deployment of those funds:

- **Q3 2026 — testnet feature-complete.** Days 8–21 of the build. ~$200k.
- **Q4 2026 — audits begin.** Solidity audit, ZK audit, infrastructure audit run in parallel. Bug bounty opens on testnet. ~$300k.
- **Q1 2027 — audit findings remediation.** A second pass on critical/high findings. Accessibility audit. Legal audit. ~$300k.
- **Q2 2027 — phased mainnet rollout.** Alpha (cap on TVL), Beta (lifted cap), General Availability. ~$200k engineering + $50k bug-bounty pool top-up + $100k operational.

Beyond that, the protocol enters its **post-launch growth phase**: v1.1 (WETH + ZEN markets), v1.5 (instant verification tier, mobile-native apps, multi-language UI), and v2 (running our own aggregation domain, cross-chain bridging UX).

---

## 10. Why we will win

Three things, in our view, are necessary for a privacy lending protocol to be a real business and not a research demo:

1. **A complete, auditable design before the first line of production code is written.** We have a 17-subsystem design document with citations and diagrams. Every architectural claim is traceable.
2. **An implementation discipline that does not skip steps.** We have a daily 21-day build plan with test gates per day, group checkpoints at days 6, 9, 12, 16, 19, and 21, and an end-of-day wrap-up reported to a human reviewer. The history is on disk: Days 1–7 wrapped on schedule with all tests passing.
3. **A market that has not been served by the existing privacy or DeFi categories.** Privacy DeFi has been TEE-blocked, sanctioned, or DEX-only. Agent DeFi has been built without privacy. The intersection is empty and the demand is provably there (treasury operators, OTC desks, AI-driven custodians).

We are not asking an investor to bet on a research breakthrough. We are asking an investor to back a **focused engineering effort** that connects components which are individually proven on testnet today, with a credible plan to audit and ship.

---

## 11. Next steps for an interested investor

1. **Sign an NDA.** We share the full 17-subsystem design folder, the implementation roadmap, the threat model, and the progress tracker.
2. **Technical deep dive.** A 90-minute walk-through of the architecture, the contracts, the circuits, and the integration tests. Live demonstration of the 180-test Foundry suite and the 48-test Noir suite running green.
3. **Reference checks.** We can connect you to the Horizen and zkVerify teams whose stack we are building on, and to engineers who have built on the same primitives (the JetHalo reference dApps).
4. **Terms discussion.** Equity vs. SAFE, board observation rights, milestone-based tranching, etc.

---

**Contact:** zenfinance4144@gmail.com

*This brief is a working summary. The authoritative source for every technical claim is the design folder at `design-v2/` and the progress tracker at `design-v2/roadmap/progress_tracker.md` in the project repository.*
