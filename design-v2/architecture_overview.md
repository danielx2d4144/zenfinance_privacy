# Privacy Lending Protocol v2 — Architecture Overview

A shielded multi-asset lending market on Horizen for **lending and borrowing
any of {USDC, cbBTC, WETH, ZEN}** against any combination of the others,
where lenders, borrowers, and **AI agents acting on their behalf** can
interact without exposing position sizes, transaction history, or address
linkages. ZK proofs verify state transitions; zkVerify aggregates them;
Horizen contracts settle them.

This file is the top-level. Each subsystem has its own `subsystems/NN_*.md`.
Final wiring is in `integration.md`.

**v1 launch scope:** USDC + cbBTC only — the multi-asset architecture is
in place from day one, but additional asset markets (WETH, ZEN) are
enabled via Safe-driven parameter governance in v1.1 / v1.2 after the
launch markets prove out.

---

## 1. Goal

Build a privacy-preserving multi-asset lending protocol on Horizen where:

- **Supplied amounts, debt amounts, and collateral amounts are private** —
  visible only to the holder (via their notes) and (optionally) to a
  pre-registered auditor.
- **Cross-collateralization works** — a borrower with 1 cbBTC + 100 ZEN
  collateral can borrow USDC, WETH, or both against the combined position.
- **Wallet addresses are unlinkable** to positions — proofs are pseudonymous
  via a spending-key derivation; the `PrivacyEntry` layer compresses
  per-operation visibility to entry + exit only.
- **AI agents can operate the protocol** on a user's behalf within
  owner-signed bounded policies (spending limits per asset, time windows,
  per-asset HF floors).
- **Liquidation discovery is solvable** without revealing position details
  by publishing per-asset price thresholds — multi-dimensional but
  k-anonymous in a pool of hundreds of positions.

What "privacy" deliberately does **not** mean here:

- We do **not** hide that *someone* deposited or borrowed (a tx is visible).
- We **do** reveal which **price thresholds** a position becomes
  liquidatable at, per collateral asset (a multi-element array per
  position).
- We do **not** hide aggregate market metrics — total supply, total borrow,
  utilization, interest rates per asset are all public by design.

This matches Tornado-Nova's threat model extended to a multi-asset
lending product.

---

## 2. Actors

| Actor | Description | Auth |
|---|---|---|
| **Lender (human)** | Connects via MetaMask / SubWallet. Generates ZK proofs in the browser. | Owns the spending key derived from their wallet. |
| **Borrower (human)** | Same as lender, on the borrow side. | Same. |
| **Lender / borrower (agent)** | LLM-orchestrated agent or traditional bot acting on behalf of a human via a delegated `AgentAccount` (ERC-4337). | Delegated session key constrained by an owner-signed `Policy`. |
| **Liquidator (anyone, human or agent)** | Watches `LiquidationBoard` for positions where `currentPrice < liquidationPrice`. Submits a `liquidate` proof to claim the bonus. Permissionless. | Standard wallet or `AgentAccount`. |
| **Protocol-operated backstop liquidator** | A keeper we run, pre-funded with USDC. Acts as lender-of-last-resort. | Treasury-funded `AgentAccount`. |
| **Auditor (optional)** | Pre-registered key. Can decrypt user notes that opted in at deposit time, after proving on-chain authorization. | Registered in `AuditorRegistry`. |
| **Admin (Den multisig)** | Holds `ADMIN_ROLE` on all contracts. 3-of-5 hardware wallet signers. | Safe at `safe.horizen.io`. |
| **Manager service (we operate)** | Off-chain. Pushes Stork prices, pokes interest accrual, runs the backstop liquidator. Has **no protocol authority** — only Horizen-account funds for keeper operations. | Server-side wallets in AWS KMS. |
| **Indexer (Goldsky)** | Maintains the subgraph + structured REST API used by both human dapp and agents. | Read-only. |
| **MCP server (we operate)** | Exposes the protocol's actions to LLM-driven agents via the Model Context Protocol. | Authenticated per agent session via the `AgentAccount`'s delegated key. |

---

## 3. End-to-end flows — both human and agent variants

### 3.1 Lender deposits USDC (human variant)

1. User connects MetaMask, picks "Deposit 50,000 USDC."
2. Dapp derives spending key from wallet (signs a fixed challenge → HKDF →
   secret). Builds a deposit note locally:
   `note = (spending_pubkey, amount, supplyIndex_at_deposit, salt, optional_auditor_pubkey)`.
3. Browser generates a Groth16/UltraHonk proof of "I have constructed a valid
   note for amount X." Proof + commitment + permit-signed USDC transfer
   submitted to `ShieldedSupplyPool.deposit(...)`.
4. Contract pulls USDC via EIP-2612 permit, inserts commitment into the
   Merkle tree, emits `SupplyDeposited(commitment, blockNumber)`.
5. Off-chain: dapp encrypts the note to the user's wallet pubkey and stores
   it (localStorage + optional IPFS backup). User now has a claim on the
   pool.

### 3.2 Lender deposits USDC (agent variant)

1. The user has previously deployed an `AgentAccount` (ERC-4337 smart wallet)
   and registered a `Policy`: "agent X may deposit/withdraw USDC up to $500k
   notional, must hold HF ≥ 2.0 across any borrows, time-limited 30 days."
2. The agent (running in a server) calls our MCP server's `deposit` tool:
   `{ asset: "USDC", amount: 50000 }`.
3. MCP server checks the agent's session against the on-chain `Policy` —
   permitted? yes.
4. Server-side prover (Node SDK using `@aztec/bb.js`) generates the same
   ZK proof the browser would.
5. The proof + a userOp signed by the agent's delegated key is submitted
   via the ERC-4337 bundler to the `EntryPoint`. The `AgentAccount`
   validates the policy, then calls `ShieldedSupplyPool.deposit(...)`.
6. The encrypted note is stored server-side, encrypted to the
   **owner's** wallet pubkey (not the agent's) — so the agent never holds
   plaintext access to the user's funds.

**Key invariant:** the agent **cannot** withdraw, repay, or otherwise touch
notes from outside its policy. The owner can revoke delegation at any time.

### 3.3 Borrow USDC against cbBTC collateral

Same shape for both human and agent. The borrow flow:

1. Borrower already has a borrow-note representing locked cbBTC collateral
   (deposited earlier; same flow as 3.1 against `ShieldedBorrowPool`).
2. Stork price is fresh (keeper has pushed in the last 30s; if stale, the
   borrow circuit's freshness check fails and the tx reverts).
3. Borrower constructs the **borrow circuit witness**:
   - Old borrow-note (collateral, debt=0 or prior debt, borrowIndex at last update)
   - New borrow-note (same collateral, debt += amount, borrowIndex_now)
   - Public inputs: nullifier of old note, commitment of new note,
     `borrowIndex_now`, `cbBTC_price_now`, recipient address, amount,
     **new `liquidationPrice` value**
   - The circuit asserts:
     ```
     new_debt = (old_debt * borrowIndex_now / old_borrowIndex) + amount
     collateral * cbBTC_price_now * LTV >= new_debt * USDC_decimals
     new_liquidationPrice = new_debt / (collateral * liquidationThreshold)
     ```
4. Proof submitted to Kurier with `chainId = Horizen testnet`. Wait
   ~3 min for `Aggregated` status.
5. `ShieldedBorrowPool.borrow(payload, aggregationTuple)` called. Contract:
   - Verifies via `verifyProofAggregation(...)`.
   - Marks old nullifier as spent.
   - Inserts new commitment.
   - **Updates `LiquidationBoard[new_commitment] = liquidationPrice`** (this
     is the public bit that solves discovery).
   - Transfers `amount` USDC to recipient.

### 3.4 Liquidation

The discovery mechanism is the major architectural shift. **Anyone** scans
`LiquidationBoard` for positions where `cbBTC_price < liquidationPrice`.
That's the bucket of liquidatable positions.

1. Liquidator (human, agent, or our backstop) sorts the board, picks a
   target commitment.
2. Builds the `liquidate` circuit witness:
   - Target commitment (input from the borrower's tree)
   - Public inputs: `cbBTC_price_now`, `borrowIndex_now`, target commitment,
     liquidator's address, debt-to-cover (capped per Aave-style close
     factor: 50% default; 100% when HF < 0.95 or debt < $2k)
3. Proof + public inputs submitted via Kurier.
4. `LiquidationBoard.liquidate(target, aggregationTuple)`:
   - Verifies via `verifyProofAggregation`.
   - Splits seized collateral: liquidator gets `debt * (1 + 5%)`; insurance
     fund gets `debt * 3%`.
   - Creates a residual borrower commitment (insertable by the liquidator
     who provided the new state).
   - Removes the old `liquidationPrice` entry; inserts the new one for the
     residual position (or deletes if fully liquidated).

The "wait" is ~3-5 min for the aggregation. In practice this means
**borrowers get a grace period** — they can repay before the liquidation
settles. This is a *feature* of the privacy-protocol design (the borrower
learns of incoming liquidation by observing the `LiquidationBoard` change
+ price proximity, and can rescue their own position).

### 3.5 Agent-initiated liquidation via MCP

A liquidation-running agent does:
```
mcp.call("scanLiquidations", { minProfitUSD: 100 })
  → returns list of (commitment, liquidationPrice, est_profit) sorted by profit

mcp.call("liquidate", { commitment, debtToCover })
  → server generates proof, submits to Kurier, returns jobId

mcp.call("pollAggregation", { jobId })
  → returns status; on Aggregated, returns the on-chain receipt
```

No proof code in the agent — that lives in our SDK behind the MCP boundary.

### 3.6 Auditor flow

User opts in at deposit time by including `auditor_pubkey` in their note.
Later, with on-chain authorization, the auditor proves "I am the registered
auditor for note N" and decrypts the off-chain note. Pattern is standard
Tornado-Nova compliance.

---

## 4. Master component map

```mermaid
graph TB
  subgraph Users
    HUM[Human user<br/>via MetaMask]
    AGT[AI agent<br/>LLM + MCP client]
    LIQ[Liquidator<br/>human / agent / our backstop]
    AUD[Optional auditor]
  end

  subgraph Client surfaces (we ship)
    UI[Next.js dapp<br/>'lending.our-domain']
    SDKB[Browser prover SDK<br/>@aztec/bb.js + UltraHonk]
    SDKN[Node prover SDK]
    MCP[MCP server<br/>typed tools for LLMs]
    REST[REST API<br/>structured market data]
  end

  subgraph Horizen chain (we deploy)
    PRIVENT[PrivacyEntry.sol<br/>token vault + balance-note tree]
    SP[ShieldedSupplyPool.sol]
    BP[ShieldedBorrowPool.sol]
    LB[LiquidationBoard.sol]
    RM[RateModel.sol]
    OR[Oracle.sol<br/>wraps Stork]
    ZV[ZkVerifier.sol]
    IF[InsuranceFund.sol]
    AA[AgentAccount.sol<br/>ERC-4337 smart wallets]
    PR[PolicyRegistry.sol]
    AR[AuditorRegistry.sol]
    SAFE[Den Safe multisig]
    EP[ERC-4337 EntryPoint<br/>canonical or Horizen-deployed]
  end

  subgraph zkVerify
    KUR[Kurier REST]
    ZKVCHAIN[zkVerify chain]
    REL[zkVerify Relayer]
    ZKVPROXY[Verifier proxy on Horizen<br/>0xCb47…2b69]
  end

  subgraph Public services
    STORK[Stork oracle network]
    GS[Goldsky subgraph]
    IPFS[(IPFS — optional<br/>encrypted note backup<br/>+ WASM artifacts)]
  end

  subgraph Our backend
    KEEP[Keepers<br/>price + accrual + backstop]
    NOTES[Note backup service<br/>optional]
  end

  HUM --> UI
  UI --> SDKB
  AGT --> MCP
  MCP --> SDKN
  MCP --> REST
  LIQ --> MCP
  LIQ --> UI

  SDKB -- submit proof --> KUR
  SDKN -- submit proof --> KUR
  KUR --> ZKVCHAIN
  ZKVCHAIN --> REL
  REL -- submitAggregation --> ZKVPROXY

  SDKB -- userOp / direct tx --> PRIVENT
  SDKN -- userOp via bundler --> EP
  EP --> AA
  AA -- policy check --> PR
  AA --> PRIVENT
  AA --> SP
  AA --> BP
  AA --> LB

  PRIVENT -- spendBalance / creditBalance<br/>(POOL_ROLE) --> SP
  PRIVENT -- spendBalance / creditBalance --> BP
  PRIVENT -- creditBalance for liquidator --> LB

  PRIVENT -- verifyProofAggregation --> ZV
  SP -- verifyProofAggregation --> ZV
  BP -- verifyProofAggregation --> ZV
  LB -- verifyProofAggregation --> ZV
  ZV --> ZKVPROXY

  SP --> RM
  BP --> RM
  LB --> RM
  LB --> OR
  BP --> OR
  OR --> STORK

  KEEP -- updateTemporalNumericValuesV1 --> STORK
  KEEP -- accrue --> RM
  KEEP -- liquidate on backstop --> LB

  LB -- bonus split --> IF
  IF -- payBadDebt --> SP

  SAFE -- ADMIN role --> PRIVENT
  SAFE -- ADMIN role --> SP
  SAFE -- ADMIN role --> BP
  SAFE -- ADMIN role --> RM
  SAFE -- ADMIN role --> IF

  PRIVENT -- emits balance commitments,<br/>nullifiers --> GS
  SP -- emits supply commitments,<br/>nullifiers --> GS
  BP -- emits borrow commitments,<br/>nullifiers --> GS
  LB -- emits liquidation events --> GS
  AA -- emits userOp events --> GS

  GS --> REST
  GS --> MCP
  GS --> UI

  AUD -- decrypt notes via registry --> AR

  NOTES -- encrypted note storage --> IPFS
  UI -- backup --> NOTES
  MCP -- backup --> NOTES
```

---

## 5. The 10 subsystems (detailed in `subsystems/`)

| # | Subsystem | Owns |
|---|---|---|
| 01 | **Shielded pools & contracts** | `ShieldedSupplyPool` (multi-asset notes), `ShieldedPositionPool` (multi-slot positions), `LiquidationBoard` (per-asset triggers), `RateModel` (per-asset kink), `AssetRegistry`, `Oracle`, `ZkVerifier`, `InsuranceFund` (per-asset reserves), `AuditorRegistry` |
| 02 | **ZK circuits** | ~12 Noir circuits, parameterized by `(asset)` or `(collateralAsset, debtAsset)` — covering supply, withdraw, deposit-collateral, withdraw-collateral, borrow, repay, liquidate, consolidate, entry, exit |
| 03 | **Smart accounts & policy engine** | `AgentAccount` (ERC-4337), `PolicyRegistry`, intent-to-userOp translation, delegation lifecycle |
| 04 | **Attestation pipeline** | Kurier submission, aggregation polling, on-chain aggregation tuple consumption |
| 05 | **Oracle & keepers** | Stork price pusher, interest accrual poker, backstop liquidator |
| 06 | **Data layer (subgraph + REST + MCP)** | Goldsky subgraph schema, structured REST API for agents, MCP server exposing typed tools |
| 07 | **Human frontend** | Next.js dapp, browser prover wiring, note management UX |
| 08 | **Agent runtime** | TS template (LangChain/Mastra compatible), Python SDK, common patterns for autonomous operation |
| 09 | **Note management** | Storage, encryption-to-wallet, optional IPFS backup, recovery from seed phrase |
| 10 | **Governance & admin** | Den Safe multisig, role assignments, runbooks, emergency procedures |
| 11 | **Artifact distribution** | Reproducible builds for circuits + contracts + WASM, IPFS pinning, audit lifecycle |
| 12 | **Privacy Entry layer** | `PrivacyEntry.sol` — token vault + balance-note tree. Compresses per-operation wallet visibility into entry+exit only. **The most important privacy-strengthening subsystem.** |
| 13 | **API contract reference** | The canonical OpenAPI 3.1 + JSON Schema + MCP tool spec that S06 implements and S07/S08 consume. Single source of truth for the off-chain interface. |
| 14 | **Interest & APY mechanics** | Authoritative reference for rate curves, index growth, accrual lifecycle, reserve factor → InsuranceFund flow, bad-debt socialization. Cross-cuts S01/S02/S05/S06/S07. |
| 15 | **Threat model & security** | Audit-ready threat enumeration mapping every threat to a concrete mitigation owned by a specific subsystem. Phased rollout + audit plan + invariants. |
| 16 | **Performance characteristics** | Latency budget, per-op timings, improvement roadmap (own aggregation domain, server proving, direct on-chain, pre-generation), SLO targets. |
| 17 | **Device support & accessibility** | Hardware/browser matrix, device-class detection + benchmark, server-assisted proving (Flavor A + B), mobile defaults, a11y / i18n / wallets. |

17 subsystems.

---

## 6. Key design decisions and their rationale

Carrying these forward to all subsystems for traceability:

| Decision | Rationale |
|---|---|
| ZK + commitment/nullifier (not VELA) | VELA isn't production; ZK gives stronger privacy with no enclave trust |
| **`PrivacyEntry` layer wraps the pools** | Compresses per-operation wallet visibility to entry + exit only. Standard for production privacy protocols (Aztec, Penumbra). Specified in Subsystem 12. |
| **Multi-asset positions from day one** | Architecture supports {USDC, cbBTC, WETH, ZEN} from launch. v1 ships with only USDC + cbBTC enabled; additional assets enabled via Safe-driven parameter governance. Matches Aave v3 mental model. |
| UltraHonk (Noir + bb v3) as primary circuit toolchain | Modern, browser-friendly, already proven by JetHalo dapps; zkVerify's UltraHonk pallet is current |
| Public `liquidationPrice` per position | Solves the discovery problem without VELA; k-anonymity in a pool of hundreds of positions; same UX as MakerDAO Vaults for liquidators |
| ERC-4337 smart accounts for agent delegation | Industry standard; allows policy enforcement at the account layer rather than per-protocol |
| MCP server (not just REST) | Standard LLM-agent integration; lets ChatGPT/Claude/etc. call our tools directly |
| Kurier (not zkVerifyJS direct) for production | Removes session-management burden; falls back to zkVerifyJS on Kurier outage |
| 3-of-5 Den Safe for admin | Identical to v1; no reason to change |
| Insurance fund + bad-debt burn (Aave v3.3) | Battle-tested; handles the edge cases the ZK design inherits |
| Conservative parameters (LTV 60%, LT 75%, bonus 10%) | Compensate for ~3-5min liquidation latency vs Aave's per-block latency |
| 5-min interest accrual cadence | Privacy protocols can't rely on per-tx accrual (state would have to be touched constantly); periodic public-index updates are cleaner |
| Auditor opt-in per deposit (Tornado-Nova model) | Survived the legal scrutiny that killed regular Tornado Cash |

---

## 7. Risks deliberately accepted (vs v1's open Qs)

| Risk | Mitigation |
|---|---|
| Cold-start: <100 users = de-facto identifiable | Standard for privacy protocols; founder/treasury seed |
| Browser prover time on the borrow circuit > 10s | Likely fine for ~5k constraints; benchmark in implementation phase. Fallback: server-assisted proving for users who opt in (trust tradeoff) |
| ERC-4337 EntryPoint may not be deployed on Horizen | We deploy our own; the canonical contract is open-source |
| Stork sequencer-down | Same Aave-style grace period; not novel |
| TLSNotary / external attestations not used here | Out of scope for v1; can add later as a credential-based gate (e.g., zk-KYC) |
| Audit cost: 6 contracts + 7 circuits + ERC-4337 + MCP | Bounded; budget ~$100k–$200k for two firms |

**Notably absent compared to v1's open questions:**
- ❌ `vk_hash(Vk::Nitro)` — we don't use the TEE pallet.
- ❌ Kurier TEE submission shape — we use the **documented** Kurier flow for UltraHonk/Groth16.
- ❌ AWS Nitro CRL — irrelevant.
- ❌ VELA production status — irrelevant.
- ❌ VELA multi-app — irrelevant.

Every one of v1's blocking unknowns is gone.

---

## 8. What's next

Phase-9 equivalent: write the 11 subsystem files. Each ~150-250 lines, focused.
Then `integration.md` to wire them.

Implementation order after design freeze:
1. Spike: prove one circuit (UltraHonk deposit) compiles + verifies on Volta.
2. Audit: get one firm to red-team this overview.
3. Build: contracts first (6 of them), then circuits (7), then SDKs, then frontends.
