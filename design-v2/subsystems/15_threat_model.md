# Subsystem 15 — Threat Model & Security

## 1. Purpose

The **single authoritative threat enumeration** for the protocol. Every
threat listed here has a **named mitigation**, an **owning subsystem
that implements it**, and a **verification criterion** an auditor can check.

If a threat does not have a concrete mitigation mapped to a subsystem,
it does not get to sit here as a "thing to worry about" — either we fix
the design or we explicitly accept the residual risk in §10.

## 2. Scope and methodology

Approach: **asset-driven threat modelling** — for each protected asset,
enumerate the attack surfaces that could harm it, then bind a mitigation
to each. Augmented with STRIDE (Spoofing, Tampering, Repudiation,
Information Disclosure, Denial of Service, Elevation of Privilege)
classification where useful.

Protected assets in order of value:
1. **User funds** (USDC + cbBTC custody in PrivacyEntry)
2. **User privacy** (positions, balances, transaction history)
3. **Protocol solvency** (InsuranceFund, lender claims)
4. **Service availability** (dapp + MCP + keepers)
5. **Operator infrastructure** (Manager, Postgres, AWS account)

## 3. Smart-contract layer (S01)

| # | Threat | STRIDE | Mitigation | Owned by | Audit-verifiable |
|---|---|---|---|---|---|
| 3.1 | Reentrancy on `deposit`/`withdraw` token transfers | T | `nonReentrant` modifier from OpenZeppelin on every state-mutating function; checks-effects-interactions ordering | [S01](01_shielded_pools.md) `ShieldedSupplyPool`, `ShieldedPositionPool`, `LiquidationBoard`, `PrivacyEntry`, `InsuranceFund` | Static-analysis check: every external function with token transfers wears `nonReentrant`; Slither pass |
| 3.2 | Integer over/underflow | T | Solidity 0.8.27 checked math by default; `unchecked {}` blocks only in explicitly-marked gas-optimisation paths | [S01](01_shielded_pools.md) all contracts | Foundry tests with extreme values; Slither/Mythril |
| 3.3 | Admin-function bypass | E | OpenZeppelin `AccessControl`; `ADMIN_ROLE` granted only to Den Safe; **no EOA ever holds `ADMIN_ROLE`** | [S01](01_shielded_pools.md) + [S10](10_governance_admin.md) | Deployment script asserts; bytecode inspection |
| 3.4 | Nullifier double-spend | T | Circuit binds nullifier to `Poseidon(secret_key, salt)`; on-chain `spent[nullifier]` mapping checked BEFORE any state mutation; reverts on duplicate | [S01](01_shielded_pools.md) all pools + [S02](02_zk_circuits.md) | Replay test in audit suite |
| 3.5 | Bad-debt drain | D | `InsuranceFund.payBadDebt(...)` then `supplyIndex` reduction (v3.3 pattern); circuit-breaker auto-pause >10% borrow liquidated in 10min | [S01](01_shielded_pools.md) `InsuranceFund` + circuit breaker | Simulation under correlated crash scenarios |
| 3.6 | Liquidation MEV (race) | T | Permissionless race + `LiquidationMissed` refund (95% of gas) + protocol backstop liquidator | [S01](01_shielded_pools.md) `LiquidationBoard._attemptLiquidate` + [S05](05_oracle_and_keepers.md) backstop | Foundry test on race outcomes |
| 3.7 | Flash-loan attack | T | **Structural immunity**: each operation requires a fresh ZK proof + 3-7 min aggregation; no atomic borrow→action→repay path exists | Inherent to [S04](04_attestation_pipeline.md) latency | Audit verifies no on-chain composability path bypasses aggregation |
| 3.8 | Oracle freshness manipulation | T | Stork freshness check: `require(block.timestamp - priceTs ≤ MAX_PRICE_AGE)`; reverts on stale | [S01](01_shielded_pools.md) `Oracle.sol` | Foundry test with manipulated `block.timestamp` |
| 3.9 | Sequencer downtime → over-liquidation | D | Manager-liveness grace period (S01 §5.7): heartbeat must be ≤60s old or liquidations blocked | [S01](01_shielded_pools.md) + [S03](03_smart_accounts_policies.md) heartbeat | Foundry test with stale heartbeat |
| 3.10 | Front-running on `openEpoch` | T | Epoch contract requires `epochIndex == currentEpoch + 1`; reverts on stale; Manager idempotency via DB | [S01](01_shielded_pools.md) + [S04](04_attestation_pipeline.md) | Foundry test with concurrent submissions |
| 3.11 | Token allowlist bypass | E | `AssetRegistry.enabled` flag checked on every operation; revert if disabled | [S01](01_shielded_pools.md) `AssetRegistry` | Foundry test attempting ops on disabled asset |
| 3.12 | Bad-debt accounting drift | T | On-chain invariants in §11; bot monitors them off-chain and pages on drift | [S01](01_shielded_pools.md) + [S06](06_data_layer.md) subgraph monitor | Continuous monitoring + alert runbook |

**Audit scope for this layer:** Cantina + Halborn (or equivalent), 4-6
weeks, **budget $80-150k**.

## 4. ZK circuit layer (S02)

Highest-risk new code in the protocol. The mitigations here are how we
sleep at night.

| # | Threat | Mitigation | Owned by | Audit-verifiable |
|---|---|---|---|---|
| 4.1 | **Circuit soundness bug** (prove invalid statements) | **Two independent ZK auditors** (Veridise + Zellic / Trail of Bits); per-circuit adversarial constraint review; fuzzing with `noir-fuzz` if available | [S02](02_zk_circuits.md) all 12 circuits + audit subsystem | Audit firms produce signed reports + public posts |
| 4.2 | Circuit completeness bug (valid proofs rejected) | Differential fuzz: 1000 random valid inputs → 100% verify rate before mainnet | [S02](02_zk_circuits.md) test suite | CI gate on the fuzz job |
| 4.3 | Witness construction leaks secrets | Code review + invariant: only declared public inputs ever serialise; pre-commit hook checks circuit signature unchanged from reviewed version | [S02](02_zk_circuits.md) + [S11](11_artifact_distribution.md) artifact pipeline | Bytecode-pinned vkHash per circuit |
| 4.4 | VK confusion (circuit A's proof verified with VK B) | Each circuit's `vkHash` registered on chain at deploy; `ZkVerifier.sol` selects vk by circuit-kind enum; **no per-call vk parameter** | [S01](01_shielded_pools.md) `ZkVerifier.sol` + [S02](02_zk_circuits.md) | Foundry test attempting cross-circuit verification |
| 4.5 | Side-channel on browser proving | Standard browser sandbox; strict CSP (`script-src 'self'`); SRI on all bundled scripts; no inline JS; no `eval` | [S07](07_human_frontend.md) | Lighthouse + CSP-evaluator checks in CI |
| 4.6 | Trusted-setup compromise | **None — UltraHonk uses no trusted setup**; barretenberg's transparent SRS is publicly auditable | Inherent to choice in [S02](02_zk_circuits.md) | Documentation only |
| 4.7 | Toolchain compromise (Noir / bb supply chain) | Pinned versions in reproducible Docker image (per [S11](11_artifact_distribution.md)); checksums in registry; community advisory monitoring | [S11](11_artifact_distribution.md) artifact pipeline | Reproducible build hash check on every release |
| 4.8 | Circuit DoS (proof size, prove time blowup) | Per-circuit constraint budget (≤15k); browser prove-time SLO ≤15s on reference device; CI gate fails if exceeded | [S02](02_zk_circuits.md) test suite | CI fails on regression |

**Audit scope for this layer:** Veridise + Zellic, 4-6 weeks, **budget
$80-120k**. ZK audits are pricier than Solidity because the talent pool
is smaller.

## 5. ERC-4337 / smart account layer (S03)

| # | Threat | Mitigation | Owned by | Audit-verifiable |
|---|---|---|---|---|
| 5.1 | **Session-key compromise** (agent's key leaked) | Owner can revoke instantly; `Policy.spendingCapPerEpoch` limits blast radius per asset; expiry timestamps mandatory | [S03](03_smart_accounts_policies.md) `AgentAccount.revokeSession` | Foundry test for revocation timing |
| 5.2 | Policy bypass via calldata trickery | Strict per-asset selector allowlist; **whitelist not blacklist**; calldata decoded and validated field-by-field before execution | [S03](03_smart_accounts_policies.md) `AgentAccount._validateAgainstPolicy` | Fuzz test with adversarial calldata; audit reads every selector path |
| 5.3 | EntryPoint vulnerability | Use **canonical** ERC-4337 EntryPoint (audited by Spearbit + OpenZeppelin) if Caldera deploys it; otherwise deploy verbatim from `eth-infinitism/account-abstraction` and verify bytecode against npm release | [S03](03_smart_accounts_policies.md) deploy script | Bytecode diff against published canonical |
| 5.4 | Bundler manipulation / censorship | Multi-bundler support (our bundler + 1-2 public bundlers); SDK fails over automatically | [S08](08_agent_runtime.md) bundler client; [S07](07_human_frontend.md) same | Integration test with bundler failover |
| 5.5 | Cross-network userOp replay | EIP-712 domain separator + chainId in every userOp signature | [S03](03_smart_accounts_policies.md) `AgentAccount._validateSignature` | Foundry test forging from one chain to another |
| 5.6 | Session creation race (owner creates 2 sessions for same agent) | `createSession` checks for existing active sessions per pubkey; rejects or replaces explicitly | [S03](03_smart_accounts_policies.md) `AgentAccount.createSession` | Foundry test |
| 5.7 | Policy upgrade backdoor | Policies are immutable once created; updating means creating a new policy + revoking sessions tied to the old one (explicit, observable) | [S03](03_smart_accounts_policies.md) `PolicyRegistry` | Static analysis: no policy field mutation paths |
| 5.8 | Owner key compromise | Same risk as any wallet — outside our scope; we recommend Safe-backed owners or hardware wallets | User responsibility | Dapp UX prompts |

**Audit scope:** combine with Solidity audit; +1 week for ERC-4337
specifics; **budget +$15-25k**.

## 6. Off-chain infrastructure (S03 backend, S05, S06)

| # | Threat | Mitigation | Owned by | Audit-verifiable |
|---|---|---|---|---|
| 6.1 | **Server-side prover compromise** (for agent flows) | Process isolation in container with read-only filesystem; **no persistent secrets in prover process**; every proof output verified on-chain; audit log of every proof generated | [S06](06_data_layer.md) MCP server + new prover service | Pen-test annual |
| 6.2 | Database breach (Postgres) | TLS-everywhere; encryption at rest via cloud KMS; row-level security per session; daily encrypted backups to separate region; **no spending keys ever stored** | [S03](03_smart_accounts_policies.md) backend + [S06](06_data_layer.md) | Schema review confirms no secret columns |
| 6.3 | Kurier API key leak | Server-side only (never browser); rotated quarterly; rate-limited per key; monitoring for abnormal usage | [S04](04_attestation_pipeline.md) | KMS rotation cron + alerting |
| 6.4 | Goldsky subgraph drift / failure | Read-only path; **on-chain state is canonical**; subgraph health dashboard pages on lag >2 min | [S06](06_data_layer.md) | Continuous monitor |
| 6.5 | MCP server impersonation (rogue server) | mTLS for production agents; published SHA-256 of MCP server image in registry; agents pin to verified image | [S06](06_data_layer.md) MCP + [S11](11_artifact_distribution.md) | Image hash pinned in agent SDK |
| 6.6 | DNS hijacking | DNSSEC; CAA records; certificate-transparency monitoring; subdomain pinning in dapp | [S07](07_human_frontend.md) infra | DNS audit pre-launch |
| 6.7 | Manager liveness failure | Active/passive HA with health-checked failover; alerts on missed accrue/heartbeat; **no fund loss possible if Manager dies** — only ops disruption | [S03](03_smart_accounts_policies.md) backend deployment | DR runbook + game day |
| 6.8 | AWS KMS key compromise | Multi-region keys; CloudTrail audit; hardware-backed; role-segregated (one role per keeper EOA) | [S05](05_oracle_and_keepers.md) | KMS access review monthly |
| 6.9 | Bundler outage (denial of service) | SDK-level multi-bundler with timeout-based failover (see 5.4) | [S07](07_human_frontend.md) + [S08](08_agent_runtime.md) | Integration test |
| 6.10 | Backend rate-limit bypass | Token-bucket per-API-key + per-IP; HMAC-signed idempotency keys to prevent replay | [S06](06_data_layer.md) + [S13](13_api_contract.md) | Load test |
| 6.11 | Time-source manipulation in keeper | Keepers use multiple NTP sources; reject prices with timestamps that drift >5 min | [S05](05_oracle_and_keepers.md) | Time-skew test |

## 7. Client-side / user layer (S07, S09)

Largest residual-risk category because user devices are outside our
control. Mitigation strategy: **defense in depth + clear user
communication**.

| # | Threat | Mitigation | Owned by | Audit-verifiable |
|---|---|---|---|---|
| 7.1 | XSS extracts spending key | Strict CSP; SRI on bundled scripts; spending key only in memory (never `localStorage`); re-derived on every page load | [S07](07_human_frontend.md) | Lighthouse CI; manual pen-test |
| 7.2 | Wallet-drainer browser extension | We can't prevent installed malware; mitigated by per-action confirmations + sane spending limits + Safe-style "preview before sign" UX | [S07](07_human_frontend.md) UX | UX review; user education |
| 7.3 | Lost notes = lost funds | Encrypted note backup service + IPFS + seed-phrase recovery flow (S09 §4) | [S09](09_note_management.md) | Recovery integration test |
| 7.4 | Phishing dapps | Visible domain pinning; wallet warnings; SafeOps standardized signing prompts; published canonical URL list | [S07](07_human_frontend.md) | User education page |
| 7.5 | Note exposure on shared computer | Notes encrypted to wallet pubkey at rest; decryption requires wallet signature; auto-clear after session timeout | [S09](09_note_management.md) | Session-timeout test |
| 7.6 | Browser sandbox escape | Outside our control; rare; covered by browser-vendor security | N/A | Documentation |
| 7.7 | Clipboard hijacking on address paste | Address checksum + confirmation modal before any tx submission | [S07](07_human_frontend.md) | UX review |
| 7.8 | Older devices fail to prove → user can't transact | Adaptive proving strategy (S17): detect device, recommend server-assisted with clear trust tradeoff | [S07](07_human_frontend.md) + new server-assisted prover service in [S06](06_data_layer.md) | Device benchmark integration test |

## 8. Cross-chain / oracle layer (S04, S05)

| # | Threat | Mitigation | Owned by | Audit-verifiable |
|---|---|---|---|---|
| 8.1 | zkVerify chain compromise (validator-set takeover) | Trust assumption — same as any L2; we monitor zkVerify validator-set changes | External | None — accept |
| 8.2 | Aggregation relayer censorship | Permissionless `aggregate(...)` — anyone can publish; fallback path via zkVerifyJS direct submission | [S04](04_attestation_pipeline.md) | Integration test of fallback path |
| 8.3 | Stork publisher compromise | Stork's own publisher-set signature check is canonical | External | Stork publishes own audit |
| 8.4 | Stork price oracle stale | On-chain freshness check (S01 §5.7); reverts on stale | [S01](01_shielded_pools.md) `Oracle.sol` | Foundry test |
| 8.5 | Bridge attack (USDC OFT / cbBTC OFT compromise) | LayerZero OFTs are our trust dependency; we monitor LayerZero security disclosures and can pause the affected market | External + [S10](10_governance_admin.md) Safe pause | Runbook for OFT incident response |
| 8.6 | Replayed aggregation tuple | `LendingMarket` tracks `(domainId, aggregationId, leafIndex)` consumed; rejects duplicates | [S01](01_shielded_pools.md) | Foundry test |
| 8.7 | Lost aggregation receipt block hash | DB schema requires `receipt_block_hash` BEFORE any other write on `Aggregated` status; transaction wraps both writes | [S04](04_attestation_pipeline.md) job persistence | DB schema test |

## 9. Privacy-specific threats

These are unique to a privacy protocol and don't fit standard threat
models. They're the cost of the privacy guarantee.

| # | Threat | Mitigation | Owned by | Audit-verifiable |
|---|---|---|---|---|
| 9.1 | **Anonymity-set fragmentation** (small pool → identifiable) | Founder/treasury seed at launch ($250k initial deposits); deposit caps until pool ≥$1M; published anonymity-set metrics | [S10](10_governance_admin.md) launch plan + [S07](07_human_frontend.md) caps UI | Monitor anonymity-set size; pause new deposits if drops |
| 9.2 | Timing-correlation attack | Default UX recommends time gaps before withdrawal; built-in 3-7 min aggregation noise; future: optional batch-relay obfuscation | [S07](07_human_frontend.md) UX recommendations | UX review |
| 9.3 | `liquidationTrigger` array leaks LTV ratios | k-anonymity once pool has hundreds of similar-LTV positions; documented privacy cost in [S14](14_interest_and_apys.md) | Inherent | Privacy review |
| 9.4 | Auditor key compromise | Audit-key rotation runbook; per-report on-chain authorization; reports encrypted per auditor (not shared key) | [S01](01_shielded_pools.md) `AuditorRegistry` + [S10](10_governance_admin.md) runbook | Runbook + multi-auditor model |
| 9.5 | Subgraph metadata aggregation deanon | Read-only; can't lose funds; metadata covers what's already on-chain; documented in [S06](06_data_layer.md) | Inherent | Privacy review |
| 9.6 | OFAC-style sanctions (Tornado-Cash precedent) | Auditor opt-in (Tornado-Nova compliance model — survived FinCEN scrutiny); jurisdiction monitoring; legal counsel engaged pre-mainnet | [S01](01_shielded_pools.md) `AuditorRegistry` + legal | Legal opinion in writing |
| 9.7 | Withdrawal-address-reuse deanon | Dapp warns + defaults recipient to blank; recommends fresh address; PrivacyEntry layer makes it the only public touch | [S07](07_human_frontend.md) + [S12](12_privacy_entry_layer.md) | UX review |
| 9.8 | Spending-key derivation leakage via wallet signing | HKDF with public challenge string; wallet only sees the challenge, not the derived key | [S07](07_human_frontend.md) `spending-key.ts` | Code review |

## 10. Explicitly accepted residual risks

Risks we have **chosen** not to fully mitigate, with justification:

| # | Risk | Why we accept |
|---|---|---|
| 10.1 | 3-7 min settlement latency | The cost of privacy + ZK aggregation. Documented; UX designed around it. |
| 10.2 | Cold-start anonymity set | Inherent to launching a new privacy pool; mitigated by founder seeding + deposit caps |
| 10.3 | `liquidationTrigger` reveals LTV ratios | Necessary for permissionless liquidation discovery without a TEE oracle |
| 10.4 | zkVerify validator-set trust | Same trust assumption as any L2; no path to remove |
| 10.5 | User loses notes + seed phrase = funds locked | Documented in onboarding; recovery process needs ≥1 of these |
| 10.6 | Old/low-end devices need server-assisted proving (less private) | Accessibility tradeoff; opt-in with clear trust disclosure |
| 10.7 | OFAC may sanction the protocol | Legal counsel engaged; auditor opt-in mitigates but doesn't remove |
| 10.8 | Auditor flow can be subpoenaed for opted-in users | Documented; opt-in is meaningful consent |

Each accepted risk gets a clear disclosure in the dapp's Terms of Service.

## 11. On-chain invariants (audit-verifiable)

These are continuously-checkable invariants that any auditor or
monitoring system can verify on production data.

| # | Invariant | Where enforced | How to verify |
|---|---|---|---|
| 11.1 | `appCustody[token]` ≥ `sum(supply_notes) × supplyIndex` for each token | Implicit via circuit + on-chain custody | Off-chain monitor in [S05](05_oracle_and_keepers.md); pages if violated |
| 11.2 | `borrowIndex × totalBorrow × (1 - reserveFactor) = supplyIndex × totalSupply × growth - badDebt` (per asset) | Implicit via accrue math | Off-chain monitor; runbook on drift |
| 11.3 | `nullifier ∈ spent` → no further use accepted | [S01](01_shielded_pools.md) every pool | Replay test |
| 11.4 | `Policy.expiresAt > block.timestamp` for every accepted userOp | [S03](03_smart_accounts_policies.md) `AgentAccount` | Foundry test on expired session |
| 11.5 | `supplyIndex` and `borrowIndex` are non-decreasing (except bad-debt socialization) | [S01](01_shielded_pools.md) `RateModel.accrue` | Index-monotonicity invariant test |
| 11.6 | `liquidationTriggers[i].priceThreshold` for any active position satisfies the derivation formula | [S02](02_zk_circuits.md) trigger circuit | Spot-check via on-chain decode |
| 11.7 | `reserveFactor[asset] < 10000` (bps) always | [S01](01_shielded_pools.md) `AssetRegistry.updateAssetConfig` validation | Foundry test |
| 11.8 | `currentEpoch.openedAt ≥ block.timestamp - 6 minutes` (else liquidations gate fails) | [S01](01_shielded_pools.md) + Manager epoch loop | Off-chain monitor; pages |

## 12. Threat-actor profiles

| Actor | Capability | What we defend against | What we don't |
|---|---|---|---|
| **Script kiddie** | Run prepackaged exploits; phish | All known patterns; standard audit catches | Novel zero-days in deps |
| **Sophisticated MEV actor** | Build custom bots; private mempool routes | Liquidation race fairness; permissionless backstop | They will win most liquidations; that's fine |
| **Targeted attacker** with $10k-$100k budget | Probe APIs, attempt social-eng of team | Layered auth; runbook for incident response; staged disclosure | A determined targeted attacker may still find issues |
| **Nation-state / well-resourced** | Full pen-test capability; chain-analysis-firm tier | Cryptographic privacy holds; metadata leaks documented | Anonymity set may not protect against true adversaries with subpoena power |
| **Insider** (us / team member) | Source code access; Safe-signer compromise | 3-of-5 Safe; KMS audit logs; CodeOwners review; no single dev can deploy | A single rogue dev cannot push to prod alone |

## 13. Audit plan

| Audit type | Firm candidates | Scope | Duration | Budget |
|---|---|---|---|---|
| **Solidity** | Cantina, Halborn, OpenZeppelin | S01 contracts + S03 ERC-4337 + S12 PrivacyEntry | 4-6 weeks | $80-150k |
| **ZK Circuits** | Veridise, Zellic, Trail of Bits | S02 all 12 circuits | 4-6 weeks | $80-120k |
| **Cryptography review** | Trail of Bits or specialized | spending-key derivation, note encryption, Poseidon usage | 2 weeks | $20-40k |
| **Infrastructure / ops** | Trail of Bits, NCC Group | Backend, KMS handling, runbooks | 2 weeks | $20-40k |
| **Legal opinion** | Lewis Brisbois (DeFi) or Cooley | Compliance with auditor opt-in model; jurisdiction-by-jurisdiction risk | ongoing | $30-60k |
| **Bug bounty** | Immunefi | All contracts + circuits + backend | continuous | $5-50k/yr platform + variable payouts up to $1M for criticals |

**Total pre-mainnet audit budget: $230-410k.** This is the floor for a
serious privacy protocol; cutting corners here is how you become a
case study.

## 14. Phased rollout (the operational mitigation)

We do not launch with uncapped TVL. Phased caps act as **per-incident
loss caps**.

| Phase | Duration | Per-user deposit cap | Total TVL cap | Triggers next phase |
|---|---|---|---|---|
| Alpha (private testnet) | 4 weeks | unlimited | unlimited | All audits pass; spike plans Q1-Q6 done |
| Beta (public testnet) | 4 weeks | $10k equiv | $1M equiv | No incidents; ≥100 unique addresses |
| Mainnet stage 1 | 4 weeks | $5k | $250k | Stable; bug bounty live; insurance funded |
| Mainnet stage 2 | 8 weeks | $50k | $5M | Stable for 4 weeks; ≥500 users |
| Mainnet stage 3 | 12 weeks | $500k | $50M | Stable; second audit pass after stage 2 |
| Full launch | — | uncapped | uncapped | All gates passed |

Total time to uncapped mainnet: **6+ months from first mainnet
deploy**. Slow and deliberate, by design.

## 15. Incident response

When something does go wrong, runbooks documented in [S10](10_governance_admin.md):

| Severity | Response | Resolver |
|---|---|---|
| **Critical** (funds at risk, ongoing) | Guardian fast-pause within 5 min; all-hands incident channel; public disclosure ≤4h | Guardian + Safe + comms lead |
| **High** (vulnerability disclosed; not actively exploited) | 24h triage + patch; 7-day coordinated disclosure | Engineering + auditors |
| **Medium** (annoyance, no fund risk) | Normal patch cycle; advisory after fix | Engineering |
| **Low** (UX, docs) | Next release | Engineering |

Bug-bounty payouts per Immunefi tier, scaling with severity + TVL:
critical can hit $1M.

## 16. Dependencies

- [S01](01_shielded_pools.md) — contracts implementing every smart-contract mitigation
- [S02](02_zk_circuits.md) — circuits implementing the ZK mitigations
- [S03](03_smart_accounts_policies.md) — ERC-4337 + policy mitigations
- [S04](04_attestation_pipeline.md) — Kurier failure handling + idempotency
- [S05](05_oracle_and_keepers.md) — heartbeat + freshness mitigations
- [S06](06_data_layer.md) — server-side prover service + monitor scripts
- [S07](07_human_frontend.md) — CSP + UX mitigations
- [S09](09_note_management.md) — note backup + recovery
- [S10](10_governance_admin.md) — Safe + Guardian + runbooks
- [S11](11_artifact_distribution.md) — reproducible builds
- [S12](12_privacy_entry_layer.md) — wallet-address compression
- [S17](17_device_support.md) — server-assisted proving for accessibility

## 17. Diagram

```mermaid
graph TB
  subgraph Assets we protect (in value order)
    A1[User funds]
    A2[User privacy]
    A3[Protocol solvency]
    A4[Service availability]
    A5[Operator infra]
  end

  subgraph Mitigation layers
    L1[Smart-contract layer<br/>S01: AccessControl, ReentrancyGuard,<br/>Pausable, Oracle freshness, Circuit breaker]
    L2[Circuit layer<br/>S02: 2 ZK audits, fuzz, vkHash registry]
    L3[ERC-4337 layer<br/>S03: per-asset policy, instant revoke,<br/>session expiry]
    L4[Off-chain infra<br/>S03/S05/S06: KMS, isolated provers,<br/>multi-bundler, monitoring]
    L5[Client layer<br/>S07/S09: CSP, SRI, note backup,<br/>encrypted-at-rest]
    L6[Cross-chain<br/>S04: idempotency, fallback, replay protection]
    L7[Privacy<br/>S09/S07/S12: opt-in audit, address compression,<br/>k-anonymity]
  end

  subgraph Operational mitigations
    O1[Phased rollout with caps]
    O2[Bug bounty $1M tier]
    O3[Incident response with Guardian fast-pause]
    O4[Audit gates: Solidity + ZK + Crypto + Infra]
  end

  L1 --> A1
  L1 --> A3
  L2 --> A1
  L2 --> A2
  L3 --> A1
  L4 --> A4
  L4 --> A5
  L5 --> A1
  L5 --> A2
  L6 --> A1
  L7 --> A2

  O1 --> A1
  O1 --> A3
  O2 --> A1
  O2 --> A4
  O3 --> A1
  O3 --> A3
  O3 --> A4
  O4 --> A1
  O4 --> A2
```
