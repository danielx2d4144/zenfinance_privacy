# Integration — How the 11 Subsystems Compose (v2)

Wires the design-v2 subsystems into one end-to-end protocol. Three
sections:

1. **§1 — Master diagram** (every node + every edge).
2. **§2 — Cross-subsystem call table** (each edge enumerated).
3. **§3 — Sequence diagrams** for the 7 main flows: lender deposit (human
   + agent), borrow + collateral deposit, repay, withdraw, liquidate
   (human + agent + backstop), agent delegation, recovery from lost notes,
   release publish.
4. **§4 — Trust boundaries.**
5. **§5 — Decisions carried through** (Phase-7 equivalents).

Subsystem short labels:
- **S01** — Shielded pools & contracts
- **S02** — ZK circuits
- **S03** — Smart accounts & policies
- **S04** — Attestation pipeline
- **S05** — Oracle & keepers
- **S06** — Data layer (subgraph + REST + MCP)
- **S07** — Human frontend
- **S08** — Agent runtime
- **S09** — Note management
- **S10** — Governance & admin
- **S11** — Artifact distribution
- **S12** — Privacy Entry layer (token vault + balance notes)
- **S13** — API contract reference (OpenAPI + JSON Schema + MCP tools)
- **S14** — Interest & APY mechanics (rate curves, index growth, reserve factor)
- **S15** — Threat model & security (mitigations mapped per-subsystem)
- **S16** — Performance characteristics (latency budget + improvement roadmap)
- **S17** — Device support & accessibility (benchmark + server-assisted proving)

---

## §1 — Master diagram

```mermaid
graph TB
  HUMAN[Human user]
  AGENT[AI agent]
  LIQ[Liquidator — human or agent]
  AUD[Auditor]

  subgraph Client surfaces
    UI[S07 Next.js dapp]
    SDKB[Browser prover<br/>bb.js WASM]
    SDKN[Node SDK<br/>S08]
    SDKPY[Python SDK<br/>S08]
    MCP[S06 MCP server]
    REST[S06 REST API]
    NOTEUI[S09 Note management UX]
  end

  subgraph Backend (we operate)
    GS[S06 Goldsky subgraph]
    PG[Postgres jobs + intents]
    PROVE_S[Server-side prover for MCP]
    BUN[ERC-4337 bundler]
    NOTEBACKUP[S09 Note backup service]
    PK[S05 Price keeper]
    IK[S05 Interest keeper]
    BL[S05 Backstop liquidator]
    KMS[AWS KMS]
  end

  subgraph Horizen
    SP[S01 ShieldedSupplyPool]
    BP[S01 ShieldedBorrowPool]
    LB[S01 LiquidationBoard]
    RM[S01 RateModel]
    OR[S01 Oracle]
    ZV[S01 ZkVerifier]
    IF[S01 InsuranceFund]
    AR[S01 AuditorRegistry]
    AA[S03 AgentAccount]
    PR[S03 PolicyRegistry]
    EP[ERC-4337 EntryPoint]
    BS_AA[Backstop AgentAccount]
    REG[S11 ProtocolArtifactRegistry]
    SAFE[S10 Den Safe]
    TIMELOCK[S10 Timelock]
    GUARDIAN[S10 Guardian]
    USDC[USDC OFT]
    CBBTC[cbBTC OFT]
    STORKC[Stork on-chain]
  end

  subgraph zkVerify network
    KUR[Kurier]
    ZKV[zkVerify chain]
    ZKVPROXY[zkVerify Aggregation Proxy on Horizen]
  end

  subgraph Public infrastructure
    STORK_API[Stork REST API]
    IPFS[(IPFS)]
    NPM[npm]
    PYPI[PyPI]
    GHCR[GHCR]
  end

  HUMAN --> UI
  UI --> SDKB
  UI --> NOTEUI
  NOTEUI -- backup --> NOTEBACKUP
  NOTEBACKUP --> IPFS

  AGENT --> SDKN
  AGENT --> SDKPY
  SDKN --> MCP
  SDKPY --> MCP
  LIQ --> MCP
  LIQ --> UI

  UI -- queries --> GS
  UI -- proof submission --> KUR
  MCP --> PG
  MCP --> PROVE_S
  PROVE_S --> KUR
  MCP --> BUN
  BUN -- userOp via EP --> EP
  EP --> AA
  AA --> PR
  AA --> SP
  AA --> BP
  AA --> LB

  REST --> GS
  MCP --> GS

  SP --> ZV
  BP --> ZV
  LB --> ZV
  ZV --> ZKVPROXY

  KUR --> ZKV
  ZKV -- relayer --> ZKVPROXY

  SP --> RM
  BP --> RM
  LB --> OR
  BP --> OR
  OR --> STORKC

  PK -- KMS key --> STORKC
  PK --> STORK_API
  IK --> RM
  BL --> BS_AA
  BS_AA --> LB
  KMS --> PK
  KMS --> IK
  KMS --> BL

  SAFE -- ADMIN --> SP
  SAFE --> BP
  SAFE --> LB
  SAFE --> RM
  SAFE --> IF
  SAFE --> AR
  SAFE --> BS_AA
  SAFE --> REG
  SAFE --> PR
  SAFE -- loosening --> TIMELOCK
  TIMELOCK --> SP
  TIMELOCK --> BP
  TIMELOCK --> RM
  GUARDIAN -- single tx --> SP
  GUARDIAN --> BP
  GUARDIAN --> LB

  REG <-- publish releases --< CI[GitHub Actions]
  CI --> IPFS
  CI --> NPM
  CI --> PYPI
  CI --> GHCR

  AUD --> AR
  AUD --> NOTEBACKUP

  IF -- payBadDebt --> SP
  LB -- bonus split --> IF

  SP -- emit commitments / nullifiers --> GS
  BP --> GS
  LB --> GS
  AA --> GS
  AR --> GS
```

---

## §2 — Cross-subsystem call table (selected)

Highest-traffic edges and their trust/verification properties.

| # | From → To | Data | Trust | Verification |
|---|---|---|---|---|
| 1 | S07/S08 (proof submitter) → S01 (pool deposit/withdraw/borrow/repay) | proof + commitment(s) + nullifier(s) + aggregation tuple | Caller is just a user; nothing privileged | `IVerifyProofAggregation.verifyProofAggregation` |
| 2 | S01 (ZkVerifier) → zkVerify Proxy | Merkle path inputs | Proxy is canonical | `Merkle.sol` verification |
| 3 | S04 (submitter) → Kurier | proof bytes + public inputs | TLS + Kurier API key | TLS; Kurier API key auth |
| 4 | Kurier → zkVerify chain | proof | Trusted to forward | `pallet-ultrahonk.verify_proof` |
| 5 | zkVerify chain → relayer → zkVerify Proxy | aggregation root | Operator role | `onlyRole(OPERATOR)` on proxy |
| 6 | S06 (MCP server) → S04 (submitter) → Kurier | server-side proof submission for agent flows | Internal | (same as #3) |
| 7 | S08 (agent) → S06 (MCP) | typed tool calls | mTLS or session-token; bounded by S03 policy | MCP transport auth; session validates against `PolicyRegistry` |
| 8 | S06 (MCP) → S03 (AgentAccount via bundler) | userOp signed by agent's delegated key | The userOp is signed; AgentAccount validates against policy on-chain | ECDSA + `_validateAgainstPolicy` |
| 9 | S03 (AgentAccount) → S01 (pool entry) | call data | AgentAccount has passed policy check | Pool checks proof + nullifier + agg, none of which AgentAccount can forge |
| 10 | S03 (AgentAccount) → S03 (PolicyRegistry) | policy lookup | Pure view call | None needed |
| 11 | S05 (price keeper) → S01 (Stork on-chain wrapper) | signed Stork update | Stork publisher signatures | Stork's publisher-set check |
| 12 | S01 (pool) → S05/Stork on-chain | price read | Public state | Freshness check (`block.timestamp - priceTs ≤ MAX`) |
| 13 | S05 (backstop) → S03 (Backstop AgentAccount) → S01 (LiquidationBoard) | liquidate userOp | Backstop is itself a delegated agent | Same as #8 + #9 |
| 14 | S07 (dapp) → S09 (note backup) | ciphertext blob | Backup holds ciphertext only | None — service can't decrypt |
| 15 | S09 → S07 (note recovery) | scan subgraph by commitment | Public reads | None needed |
| 16 | S10 (Safe) → S01 / S03 / S11 (admin calls) | governance txs | 3-of-5 hardware-signed | `AccessControl.onlyRole(ADMIN)` |
| 17 | S10 (Safe) → S10 (Timelock) → S01 | loosening param changes | Delayed | `TimelockController.execute` after 48h |
| 18 | S10 (Guardian) → S01 (pause) | single-tx pause | Single hardware key | `_pause()` is the only authorised action |
| 19 | S11 (registry) → public readers | release manifest | Public read | None needed |
| 20 | S06 (subgraph) → S07/S08 | indexed data | Read-only | None — public data |

---

## §3 — Sequence diagrams (selected key flows)

### 3.1 Human lender deposits USDC

```mermaid
sequenceDiagram
    actor U as Lender
    participant W as Wallet
    participant UI as S07 Dapp
    participant PROVER as Browser prover (S07)
    participant NOTES as S09 Note storage
    participant KUR as Kurier
    participant SP as S01 SupplyPool
    participant ZKP as zkVerify Proxy

    U->>UI: "deposit 50,000 USDC"
    U->>W: sign challenge (one time)
    W-->>UI: spending key derived

    U->>W: sign EIP-2612 permit
    W-->>UI: permit sig

    UI->>PROVER: build note + generate proof
    PROVER-->>UI: proof + publicInputs (~5s)

    UI->>NOTES: encrypt to wallet pubkey, save locally
    NOTES-->>UI: ok

    UI->>KUR: POST /submit-proof (ultrahonk, chainId=Horizen)
    KUR-->>UI: jobId
    loop poll
        UI->>KUR: /job-status/{jobId}
        KUR-->>UI: status
    end
    KUR-->>UI: Aggregated + aggDetails

    UI->>W: sign tx: SupplyPool.deposit(...)
    W->>SP: deposit(amount, commitment, permit, aggTuple)
    SP->>ZKP: verifyProofAggregation
    ZKP-->>SP: true
    SP-->>UI: SupplyDeposited(commitment, ...) emitted
    UI->>U: render private position
```

### 3.2 Agent-driven borrow

```mermaid
sequenceDiagram
    actor AGENT as Agent
    participant MCP as S06 MCP server
    participant PR as S03 PolicyRegistry
    participant PROVE as S06 Server prover
    participant KUR as Kurier
    participant BUN as Bundler
    participant EP as EntryPoint
    participant AA as S03 AgentAccount
    participant BP as S01 BorrowPool
    participant ZKP as zkVerify Proxy

    AGENT->>MCP: tools.action.borrow({amount: 50000, minHF: 2.0})
    MCP->>PR: lookup policy for agent's session
    PR-->>MCP: Policy
    MCP->>MCP: check policy constraints (cap, hfFloor, allowedSelectors)
    MCP->>PROVE: generate borrow proof
    PROVE-->>MCP: proof + public inputs
    MCP->>KUR: POST /submit-proof
    KUR-->>MCP: jobId
    MCP-->>AGENT: { intentId }

    loop AGENT polls
        AGENT->>MCP: tools.intent.status({intentId})
        MCP->>KUR: /job-status
        KUR-->>MCP: status
        MCP-->>AGENT: status
    end

    KUR-->>MCP: Aggregated + aggDetails

    MCP->>BUN: submit userOp (signed by agent's delegated key)
    BUN->>EP: handleOps([userOp])
    EP->>AA: validateUserOp
    AA->>PR: lookup(policyId)
    PR-->>AA: Policy
    AA->>AA: check selector + cap + hfFloor against intent
    AA-->>EP: valid
    EP->>AA: executeUserOp
    AA->>BP: borrow(payload, aggTuple)
    BP->>ZKP: verifyProofAggregation
    ZKP-->>BP: true
    BP-->>AA: borrow OK, USDC released to recipient

    AGENT->>MCP: tools.intent.status({intentId})
    MCP-->>AGENT: confirmed { txHash }
```

### 3.3 Backstop liquidation (we operate)

```mermaid
sequenceDiagram
    participant BL as S05 Backstop loop
    participant GS as S06 Goldsky
    participant PROVE as S08-like server prover
    participant KUR as Kurier
    participant BUN as Bundler
    participant BS_AA as Backstop AgentAccount
    participant LB as S01 LiquidationBoard
    participant ZKP as zkVerify Proxy

    BL->>GS: scan LiquidationPosition where liquidationPrice > currentPrice
    GS-->>BL: candidate list
    Note over BL: wait 30s — give 3rd-party liquidators first crack

    alt position still active
        BL->>PROVE: generate liquidate proof
        PROVE-->>BL: proof + inputs
        BL->>KUR: POST /submit-proof
        loop poll
            BL->>KUR: /job-status
        end
        KUR-->>BL: Aggregated + aggDetails

        BL->>BUN: submit userOp (signed by backstop's delegated key)
        BUN->>BS_AA: validate + execute
        BS_AA->>LB: liquidate(commitment, residual, ...)
        LB->>ZKP: verifyProofAggregation
        ZKP-->>LB: true
        LB-->>BS_AA: collateral seized → BS_AA pendingClaims
    else
        BL->>BL: skip, another liquidator won
    end
```

### 3.4 Agent delegation setup

```mermaid
sequenceDiagram
    actor OWNER as Human owner
    participant UI as S07 Dapp
    participant W as Wallet
    participant PR as S03 PolicyRegistry
    participant AA as S03 AgentAccount

    OWNER->>UI: open /agent, build policy via wizard
    UI->>W: sign EIP-712 policy
    W-->>UI: policy + signature
    UI->>PR: register(policy, signature)
    PR-->>UI: policyId

    OWNER->>UI: "deploy AgentAccount" (if first time)
    UI->>W: send deploy tx
    W->>AA: factory.createAccount(owner)
    AA-->>UI: agentAccount address

    OWNER->>UI: paste agent's pubkey
    UI->>W: sign createSession tx
    W->>AA: createSession(agentPubkey, policyId, expiresAt)
    AA-->>UI: sessionId

    UI-->>OWNER: pasteable config bundle for the agent
```

### 3.5 Note recovery (after loss)

```mermaid
sequenceDiagram
    actor U as User who lost notes
    participant UI as S07 Dapp
    participant W as Wallet
    participant GS as S06 Goldsky

    U->>UI: "I lost my notes, help me recover"
    U->>W: sign the spending-key challenge
    W-->>UI: spending key derived

    UI->>GS: scan all commitments
    GS-->>UI: full list
    loop for each commitment
        UI->>UI: try-derive (salt, leafIndex) for this commitment;<br/>check if it matches via local re-computation
    end
    UI->>GS: cross-check nullifier set
    GS-->>UI: which derived nullifiers are already spent
    UI-->>U: restored notes list (unspent ones are live)
```

### 3.6 Multi-operation user lifecycle (the PrivacyEntry win)

The most important sequence — shows how wallet visibility compresses to
just two events across a long-running active user.

```mermaid
sequenceDiagram
    actor U as User (0xABC, one main wallet)
    participant W as Wallet
    participant UI as S07 Dapp
    participant PE as S12 PrivacyEntry
    participant SP as S01 ShieldedSupplyPool
    participant BP as S01 ShieldedBorrowPool
    participant LB as S01 LiquidationBoard

    Note over U,LB: ── Day 1: Initial funding ──
    U->>W: sign permit + tx
    W->>PE: deposit(USDC, 100k, commitment, permit) <br/>[PUBLIC: 0xABC → PrivacyEntry, 100k USDC]
    PE->>PE: insert balance-note commitment

    Note over U,LB: ── Day 5: Supply 50k USDC ──
    UI->>UI: generate balance_to_supply proof
    UI->>SP: supply(balanceNullifier, residualBalance,<br/>supplyCommitment, aggTuple)<br/>[no ERC-20 transfer, just commitments]
    SP->>PE: spendBalance(...) — POOL_ROLE
    PE->>PE: spent[nullifier]=true; insert residual balance
    SP->>SP: insert supply commitment

    Note over U,LB: ── Day 7: Deposit cbBTC ──
    U->>W: sign permit + tx
    W->>PE: deposit(cbBTC, 1.0, commitment, permit) <br/>[PUBLIC: 0xABC → PrivacyEntry, 1 cbBTC]

    Note over U,LB: ── Day 10: Lock collateral + borrow 30k ──
    UI->>BP: lockCollateral(...) [no ERC-20]
    BP->>PE: spendBalance(cbBTC) — POOL_ROLE
    UI->>BP: borrow(...) [no ERC-20]
    BP->>PE: creditBalance(newUsdcBalance) — POOL_ROLE
    BP->>LB: updateLiquidationPrice

    Note over U,LB: ── Day 15: Repay 10k of debt ──
    UI->>BP: repay(...) [no ERC-20]
    BP->>PE: spendBalance(USDC, 10k)

    Note over U,LB: ── Day 30: Borrow another 15k ──
    UI->>BP: borrow(...) [no ERC-20]
    BP->>PE: creditBalance(newUsdcBalance)

    Note over U,LB: ── Day 60: Exit — withdraw remaining USDC ──
    UI->>PE: withdraw(balanceNullifier, residualCommitment,<br/>USDC, 0xABC, amount, aggTuple)
    PE->>W: transfer USDC <br/>[PUBLIC: PrivacyEntry → 0xABC, X USDC]

    Note over U,LB: Public touches of 0xABC: TWO deposits + ONE withdraw = 3<br/>(would be 7+ without PrivacyEntry)
```

### 3.7 Release publish (from S11)

```mermaid
sequenceDiagram
    participant DEV as Developer
    participant GH as GitHub
    participant CI as GitHub Actions
    participant FORGE as foundry docker
    participant NOIR as noir+bb docker
    participant IPFS as IPFS
    participant SAFE as S10 Safe
    participant REG as S11 Registry

    DEV->>GH: git tag v1.0.0 + push
    GH->>CI: trigger release.yml
    CI->>FORGE: build contracts in pinned image
    CI->>NOIR: build circuits + vkeys in pinned image
    CI->>CI: build SDKs + MCP image (pinned)
    CI->>IPFS: pin all artifacts via Pinata + Filebase
    CI-->>DEV: prepared `register(manifest)` tx data
    DEV->>SAFE: propose tx
    SAFE->>SAFE: 3-of-5 sign
    SAFE->>REG: register(...)
    REG-->>PUBLIC: emit Published(idx, semver, manifestSha, cid)
```

---

## §4 — Trust boundaries

```mermaid
graph TB
  subgraph Untrusted by design
    USER[User wallet]
    AGENT[Agent process]
    LIQ[3rd-party liquidator]
    MCP[Our MCP server]
    KUR[Kurier]
    BUN[Bundler]
    GS[Goldsky]
    NOTEBACKUP[Note backup]
    IPFS_NODE[IPFS providers]
  end

  subgraph Trusted but pinned
    SAFE[Den Safe 3-of-5]
    GUARDIAN_K[Guardian key]
    KEEPER_K[Keeper EOAs in KMS]
    STORK_PUB[Stork publishers]
    OWN_REG[Owner's PolicyRegistry signature]
    AUD_KEY[Auditor key]
  end

  subgraph Mathematical trust root
    ZK[Noir circuits + UltraHonk]
    MERKLE[Merkle.sol]
  end

  subgraph On-chain neutral arbiter
    POOLS[S01 contracts]
    PR[PolicyRegistry]
    AA[AgentAccount]
    ZKP[zkVerify proxy]
    ZKV_CHAIN[zkVerify pallet-ultrahonk]
    REG[ProtocolArtifactRegistry]
  end
```

### Trust-minimisation per concern

| Concern | Trust answer |
|---|---|
| Will my deposit be safe? | Contract holds custody; only proofs + nullifiers move funds. No off-chain trust. |
| Will my borrow be approved? | Pure circuit check on LTV using public Stork price + public indices. No off-chain trust. |
| Can the MCP server steal funds from my agent? | No — every userOp passes through `AgentAccount` policy check; MCP holds session keys but those are bounded by `PolicyRegistry`. Owner can revoke instantly. |
| Can a liquidator front-run me? | Same as MakerDAO Vaults — they can, the public `liquidationPrice` reveals when. Mitigated by conservative LTV + grace period during ~3-5 min aggregation. |
| Can Kurier corrupt state? | No — they only relay; aggregated proofs verified on-chain. |
| Can Goldsky lie? | No — read path only; cannot affect solvency. |
| Can the note backup service spy on me? | They see ciphertext + access patterns. Solved by uniform-padding + optional Tor / personal IPFS pin. |
| Can the Safe go rogue? | One signer can't; 3-of-5 can change params but cannot mint funds (no minting power on contracts). 48h timelock on protections-loosening. Guardian can pause but cannot unpause or move funds. |
| Can a circuit bug drain the protocol? | Possible — same threat as any ZK protocol. Two ZK auditors before launch (Subsystem 10). Bug bounty. |
| Is the deployed bytecode the audited code? | Verifiable via S11's reproducible builds + on-chain registry. |

---

## §5 — Decisions carried through

The same kind of carry-forward table v1 had. Lists every key decision and
where it's enforced.

| Decision | Source | Enforced at |
|---|---|---|
| ZK + commitments (not VELA) | v2 pivot | S01 contracts + S02 circuits |
| **`PrivacyEntry` layer for "one-wallet user" privacy** | v2 refinement | **S12** + S01 + S02 |
| **Multi-asset positions ({USDC, cbBTC, WETH, ZEN}) from day one** | v2 multi-asset pass | S01 `AssetRegistry`, S02 multi-slot circuits, S03 per-asset policies, S06 asset-parameterized MCP tools, S07 asset selector UI |
| **v1 launch = USDC + cbBTC only; WETH + ZEN added v1.1/v1.2 via Safe** | v2 multi-asset pass | S01 `AssetRegistry.enabled` flag |
| Two markets in v1 (USDC + cbBTC) | architecture §6 | S01 `AssetRegistry` enabled flags |
| Public `liquidationPrice` for discovery | architecture §3 | S01 `LiquidationBoard` + S02 borrow circuit |
| UltraHonk (Noir + bb v3) | architecture §6 | S02, S04 submission body |
| Conservative parameters (LTV 60%, LT 75%, bonus 10%) | architecture §6 | S01 risk params |
| 5% liquidator bonus / 3% to insurance fund | (v1 carried over) | S01 `LiquidationBoard._splitBonus` + S01 `InsuranceFund` |
| ERC-4337 smart accounts for agents | architecture §6 | S03 |
| MCP server first-class | architecture §6 + user req | S06 |
| Kurier as primary; zkVerifyJS fallback | architecture §6 | S04 |
| 3-of-5 Den Safe + Guardian | architecture §6 | S10 |
| Aave v3.3-style bad-debt burn + InsuranceFund | (v1 carried over) | S01 `payBadDebt` + circuits |
| Reproducible builds for all artifacts | new in v2 | S11 |
| Auditor opt-in per deposit (Tornado-Nova) | architecture §1 | S01 `AuditorRegistry` + S02 circuits |
| 48h timelock on protections-loosening | S10 | S10 `TimelockController` |
| No facilitator (gasless) in v1 | (v1 carried over) | not deployed |
| Note backup + recovery story | new in v2 | S09 |
| Backstop liquidator runs on its own AgentAccount | S10 §5 | S05 + S03 |

---

## §6 — What's next

1. **Spike**: prove one circuit (UltraHonk deposit) compiles + verifies
   on Volta. Goal: confirm browser proof generation completes <10s and
   the on-chain `verifyProofAggregation` returns true.
2. **Audit prep**: hand this overview + the 11 subsystem docs to at least
   one ZK-aware firm (Veridise, Zellic) for an architectural-review pass
   before contract code.
3. **Implementation order** (rough dependency order):
   1. S11 build pipeline (so the rest is reproducible from day one).
   2. S01 contracts.
   3. S02 circuits.
   4. S03 smart accounts.
   5. S04 attestation pipeline (SDK + server-side).
   6. S05 keepers.
   7. S06 data layer.
   8. S07 + S08 + S09 (parallel — frontend, agent SDK, note management).
   9. S10 governance (last — once everything else is in place).
4. **Estimate** to audited testnet: ~4-6 months with 3-4 engineers.
5. **Estimate** to audited mainnet: ~6-9 months after audit findings
   addressed.
