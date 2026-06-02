# Project Overview

## 1. What we're building

A **privacy-preserving multi-asset lending protocol on Horizen** —
deposit, supply, borrow, repay, and liquidate across {USDC, cbBTC, WETH,
ZEN} **without exposing position sizes, transaction history, or
address-to-position linkage**. Accessible to both **human users** (via a
Next.js dapp) and **AI agents** (via an MCP server + REST API +
ERC-4337 smart accounts with bounded delegation).

In one sentence: **Aave's lending model, with Tornado-Nova's privacy
mechanics, and Claude / GPT / etc. as first-class users.**

## 2. The DeFi problems we solve

| Problem in transparent DeFi today | What we do about it |
|---|---|
| **Position size is public.** Anyone watching the chain knows your collateral, debt, and health factor in real time. Whales get front-run; treasuries reveal their working capital to competitors; retail users get phished based on holdings. | All amounts live in ZK-committed notes. Only the user (and optionally a pre-registered auditor) can see them. |
| **Wallet address links every operation.** Each interaction adds another data point to your on-chain identity. | PrivacyEntry layer compresses wallet visibility to entry + exit only. Once you fund the privacy layer, every subsequent action is unlinked. |
| **Agent-friendly DeFi infrastructure is missing.** Aave / Compound assume browser users. LLM-driven agents have no native tool catalogue and no bounded-delegation primitive. | First-class MCP server with typed tools + ERC-4337 smart accounts with per-asset policy enforcement. |
| **Regulatory exposure of fully-private protocols (Tornado precedent).** Pure anonymity protocols can be sanctioned. | Optional auditor opt-in per deposit (Tornado-Nova model). Compliance built in without forcing it on every user. |
| **MEV / liquidation wars favor sophisticated bots.** Borrowers get sandwich-attacked by professional searchers. | Liquidation discovery via `LiquidationPrice` array (k-anonymous in a deep pool) + 3-7 min aggregation latency creates a structural grace period for borrowers to rescue positions. |

## 3. Who this is for

### 3.1 Primary target users (humans)

| Segment | Why they pick us |
|---|---|
| **Privacy-conscious DeFi natives** | Already on Aave / Compound, want the same with privacy |
| **Treasury operators (DAOs, family offices)** | Need to borrow USDC for ops without revealing treasury size to competitors |
| **OTC desks** | Use private credit lines for short-term capital flexibility |
| **High-net-worth individuals** | Don't want their on-chain net worth public |
| **Users in jurisdictions with active chain analysis** | Privacy is not paranoia for them |

### 3.2 Primary target users (agents)

| Segment | Why they pick us |
|---|---|
| **LLM-driven treasury automation** | Owner sets policy ("borrow up to $500k USDC, never let HF drop below 2.0"), agent executes within bounds |
| **Liquidator bots** | Built-in incentives + native MCP catalog mean a liquidator bot is <100 lines of code |
| **Algorithmic rebalancing agents** | Manage multi-asset positions with parameterised strategy |
| **Custodial-tech-as-a-service** | Privacy-preserving infrastructure they can offer to their own customers |

### 3.3 Explicitly NOT targeted in v1

- Pure retail traders who want speed above all (Aave on Base is 100× faster than us; they should use it).
- Anonymity-maxi users who reject any auditor channel (we include the channel; they can use Tornado-style protocols).
- Cross-chain composability use cases (we live on Horizen + zkVerify; no cross-chain in v1).
- Margin-trading / leveraged-perps users (we're spot lending, not derivatives).

## 4. Core flows we deliver

### 4.1 Human flow

```
1. Connect wallet (MetaMask / SubWallet / Coinbase / WalletConnect)
2. Deposit USDC or cbBTC → PrivacyEntry layer (one-time, public on chain)
3. Supply or use as collateral → entirely private from here on
4. Borrow against collateral (optional)
5. Repay, withdraw collateral, or close position
6. Withdraw funds to external address (one-time, public on chain)
```

Between step 2 and step 6, **all activity is private**: positions, debts,
LTV ratios, transaction count, interest accrued. Only public:
aggregate market metrics + per-position liquidation triggers.

### 4.2 Agent flow

```
1. Owner deploys AgentAccount (ERC-4337 smart wallet)
2. Owner signs a Policy off-chain (per-asset spending caps, HF floor, expiry)
3. Owner registers Policy on chain
4. Owner gives agent a delegated session key
5. Agent operates via MCP server / REST API
   - Discovers tools via mcp.tools.list
   - Submits intents (deposit, supply, borrow, repay, liquidate)
   - Polls intent status; receives streaming events
6. Owner can revoke session instantly via dapp
```

### 4.3 Liquidator flow (anyone — human or agent)

```
1. Scan LiquidationBoard for positions where currentPrice < trigger
2. Submit LIQUIDATE intent with (target, collateralAsset, debtAsset)
3. Wait for aggregation (~3-7 min)
4. Receive seized collateral via PrivacyEntry balance
5. Withdraw or convert
```

## 5. What we deliberately leave out (v1)

The list below isn't "we couldn't figure out how" — it's "we considered
it and decided no for v1."

| Out of v1 scope | Why excluded |
|---|---|
| **Mainnet launch** | VELA mainnet doesn't exist yet; mainnet for our protocol is unblocked when Horizen ships VELA mainnet. v1 is testnet-only. |
| **More than 2 enabled markets** | USDC + cbBTC at launch; WETH and ZEN added via Safe governance in v1.1 / v1.2 (architecture supports all 4 from day one) |
| **Cross-chain bridging UX** | LayerZero handles USDC + cbBTC bridging to Horizen separately; we treat them as native ERC-20s on Horizen |
| **Self-aggregating chain** | We use zkVerify's System Domain 175; running our own aggregation is v1.1 |
| **Direct on-chain ZK verification** (the "premium / instant" tier) | v1.5 feature; v1 launches with the aggregated path only |
| **Flash loans** | Structurally impossible in our design (each op needs 3-7 min aggregation); not adding a fast path in v1 |
| **Facilitator pattern / gasless onboarding** | Per Q3.10 resolution: v1 is direct submission only |
| **Governance token** | Per Q3.7: no token in v1; Den multisig only |
| **Stablecoin minting / CDP-style** | Not lending in the supply-and-borrow sense; out of scope |
| **Margin trading / leverage loops** | Not a derivatives protocol |
| **Fiat on/off-ramps** | We use already-bridged USDC; no fiat ramp inside our protocol |
| **Mobile-native app** | Web-first; mobile via web (responsive). Native iOS/Android v1.5+ |
| **Multi-language UI** | English only at v1 launch; 5 more languages in v1.1 (i18n framework in place) |
| **Auditor portal as separate app** | v1: auditors use the same dapp with an "auditor mode" route. Separate portal v1.5+ |
| **Insurance fund staking / yield to lenders** | InsuranceFund is fed by reserve factor; no separate staking in v1 |

## 6. Success metrics

What we measure to know v1 launched successfully:

### 6.1 Technical health

- [ ] All 5 audits passed (Solidity, ZK, Crypto, Infra, Legal)
- [ ] All 6 spike plans (Q1-Q6) passed
- [ ] WCAG 2.1 AA accessibility audit passed
- [ ] Reproducible builds confirmed across machines
- [ ] On-chain invariants (S15 §11) monitor green for 30 days
- [ ] No critical or high bug-bounty findings in first 90 days

### 6.2 Adoption

- [ ] ≥100 unique users in first 30 days
- [ ] ≥$1M total locked value (anonymity-set floor)
- [ ] ≥5 third-party liquidators participating
- [ ] ≥3 agent-driven users (treasury/automation)
- [ ] Mean operation latency p95 ≤7 min (S16 SLO)

### 6.3 Operational

- [ ] No incident exceeding "High" severity
- [ ] Bug bounty live + paid out at least one valid finding
- [ ] Insurance fund accumulated ≥1% of TVL
- [ ] Keeper uptime ≥99.9%
- [ ] Subgraph indexing lag p95 ≤30s

## 7. Non-goals

- **We are not the fastest lending protocol.** Aave / Compound are 50-100× faster. We accept that as the cost of privacy.
- **We are not a yield aggregator.** We are a lending market; yield comes from real borrowers paying interest.
- **We are not a privacy maximalist.** We include an auditor opt-in. Pure anonymity is not our positioning.
- **We are not "all things to all users."** Two markets at launch. Conservative parameters. Phased rollout. Boring, deliberate.

## 8. The honest narrative

A protocol like this is **possible to build today** with proven components
(zkVerify + UltraHonk + ERC-4337 + the JetHalo reference patterns).
Implementation is a real 21-day-coding effort across well-defined
subsystems. Risk is bounded by the audit + spike + phased-rollout plan
in [S15](../subsystems/15_threat_model.md).

It's not vapor. It's not certain. It's a project with a complete design,
a documented engineering plan, and a clear path from here to mainnet.

## 9. Where to read further

| To understand | Read |
|---|---|
| The complete architecture | [`../architecture_overview.md`](../architecture_overview.md) |
| Each subsystem in depth | [`../subsystems/01_*.md`](../subsystems) through [`17_*.md`](../subsystems) |
| How subsystems compose | [`../integration.md`](../integration.md) |
| The first spike to de-risk | [`../spikes/01_critical_path.md`](../spikes/01_critical_path.md) |
| Security threat model | [`../subsystems/15_threat_model.md`](../subsystems/15_threat_model.md) |
| Tech stack + boundaries | [`architecture_context.md`](architecture_context.md) |
| The 21-day build plan | [`code_roadmap.md`](code_roadmap.md) |
| Coding standards | [`code_standard.md`](code_standard.md) |
| Rules for the AI coder | [`agent_workflow_rules.md`](agent_workflow_rules.md) |
