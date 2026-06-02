# Architecture Context

The tech stack, the layers, and the invariants the codebase must never
break. This file is the **engineering ground truth** — when the coding
agent has to make a judgement call about where something goes, this is
the authority.

## 1. Tech stack

### 1.1 On-chain (Horizen Testnet → Mainnet)

| Layer | Technology | Pinned version |
|---|---|---|
| Smart-contract language | Solidity | **0.8.27** (matched to OpenZeppelin v5.x) |
| Build / test framework | Foundry | nightly, pinned by commit hash in Docker |
| Standard library | OpenZeppelin Contracts | **v5.0.x** (use `AccessControl`, `Pausable`, `ReentrancyGuard`, `ECDSA`) |
| ERC-4337 | `@account-abstraction/contracts` (eth-infinitism) | **v0.7.0** |
| ERC-4337 EntryPoint (canonical) | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (CREATE2-deterministic; same address on every chain that ran the standard deployer) | **v0.7.0** — confirmed deployed on Horizen testnet (Caldera L3 on Base Sepolia, chain 2651420) 2026-05-30; bytecode-hash matches Ethereum mainnet deployment |
| ZK verifier interface | `IVerifyProofAggregation` from `zkv-attestation-contracts` | mainnet ABI pin |
| Token interfaces | `IERC20` (OpenZeppelin) — no custom token logic | — |

### 1.2 ZK circuits (off-chain)

| Layer | Technology | Pinned version |
|---|---|---|
| Circuit language | Noir | **1.0.0-beta.18** (paired with bb v3 toolchain via [bb-versions.json](https://github.com/AztecProtocol/aztec-packages/blob/next/barretenberg/bbup/bb-versions.json)) |
| Proof backend | Barretenberg (`bb`) | **v3.x line** (UltraHonk-ZK flavour + Keccak transcript). Dev pin: 3.0.0-nightly.20260102. **Required for zkVerify compatibility:** the Volta pallet's `UltrahonkVersion` enum only has `V0_84` / `V3_0` / `Legacy` variants — v5 proofs are accepted at registration (vk size matches V3_0 = 1888 bytes) but fail `optimisticVerify` because the proof body layout differs. Day-19 reproducibility build will lock to a specific commit. |
| Browser prover | `@aztec/bb.js` | matches `bb` version (v3.x) |
| Test framework | `nargo test` + custom Node harness | — |
| Reproducible build | pinned Docker image per [S11](../subsystems/11_artifact_distribution.md) | — |

### 1.3 Off-chain backend

| Layer | Technology | Pinned version |
|---|---|---|
| API runtime | Node 22 LTS | latest patch within 22.x |
| Backend framework | NestJS or Fastify (TBD on Day 16) | latest stable |
| MCP server | `@modelcontextprotocol/sdk` (TypeScript) | latest stable |
| Database | PostgreSQL | **16.x** |
| Cache / fan-out | Redis | **7.x** |
| Subgraph | Goldsky-hosted Graph subgraph | latest mappings format |
| Server-side prover | Node + `@aztec/bb.js` running on EC2 | matches client `bb.js` |
| Bundler (ERC-4337) | `eth-infinitism/bundler` reference | pinned by tag |
| Secret management | AWS KMS + AWS Secrets Manager | — |
| Logging | structured JSON to CloudWatch | — |
| Metrics | Prometheus + Grafana | — |

### 1.4 Client (dapp)

| Layer | Technology | Pinned version |
|---|---|---|
| Framework | Next.js | **14.x** App Router |
| Language | TypeScript | strict mode, no `any` |
| Wallet integration | `ethers` v6 + WalletConnect v2 + RainbowKit (or wagmi) | latest stable |
| In-browser prover | `@aztec/bb.js` (matches backend) | pinned |
| Styling | Tailwind CSS | latest stable |
| State | Zustand or React Query | — |
| i18n | `next-intl` | — |

### 1.5 Agent runtime / SDKs

| Layer | Technology | Pinned version |
|---|---|---|
| TS SDK | npm package `@lending/sdk-ts` | semver |
| Python SDK | PyPI package `lending-agent-py` | semver |
| MCP client | `@modelcontextprotocol/sdk` | matches server |

### 1.6 External services (approved per Phase-7 resolutions)

| Service | What we use it for | Approved in |
|---|---|---|
| AWS (EC2, KMS, S3, CloudWatch) | Hosting, secrets, backups, monitoring | Q2.1 |
| Kurier REST API | zkVerify proof submission | Q2.2 |
| Goldsky | Subgraph indexing | Q2.3 |
| Den / Safe on Horizen | Multisig admin | Q2.4 |
| Stork on-chain oracle | USD price feeds | Q2.5 |
| Pinata + Filebase | IPFS pinning | Q2.7 |
| Immunefi (or equivalent) | Bug bounty | new in S15 |

**The coding agent may NOT introduce new external services without
explicit user approval per `agent_workflow_rules.md` rule "external
services require user authorization."**

## 2. The layer model

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 6: CLIENTS                                                 │
│   Human dapp (Next.js)        Agent SDKs (TS / Python)            │
│                               + MCP integration                   │
└──────────────────────────────────────────────────────────────────┘
                              │ talks via L5 contract
┌──────────────────────────────────────────────────────────────────┐
│ Layer 5: API surface                                             │
│   OpenAPI 3.1 REST + MCP server + GraphQL subgraph               │
│   (single source of truth = S13)                                 │
└──────────────────────────────────────────────────────────────────┘
                              │ implements
┌──────────────────────────────────────────────────────────────────┐
│ Layer 4: Backend services                                         │
│   API server, server-side prover, keepers, intent tracker         │
│   (one Postgres + one Redis behind it)                            │
└──────────────────────────────────────────────────────────────────┘
                              │ submits proofs via
┌──────────────────────────────────────────────────────────────────┐
│ Layer 3: Cross-chain                                              │
│   Kurier API → zkVerify → relayer → Horizen proxy                 │
│   (S04 attestation pipeline)                                      │
└──────────────────────────────────────────────────────────────────┘
                              │ verified by
┌──────────────────────────────────────────────────────────────────┐
│ Layer 2: ZK circuits                                              │
│   10-12 Noir circuits (entry, supply, borrow, repay, liquidate,…) │
│   (S02)                                                           │
└──────────────────────────────────────────────────────────────────┘
                              │ consumed by
┌──────────────────────────────────────────────────────────────────┐
│ Layer 1: On-chain contracts                                       │
│   PrivacyEntry + AssetRegistry + RateModel + ShieldedSupplyPool   │
│   + ShieldedPositionPool + LiquidationBoard + InsuranceFund       │
│   + AgentAccount + PolicyRegistry + Oracle + ZkVerifier           │
│   (S01 + S03 + S12)                                               │
└──────────────────────────────────────────────────────────────────┘
```

## 3. Layer boundaries (the rules)

### 3.1 Boundaries that MUST NOT be crossed

| Boundary | Rule | Why |
|---|---|---|
| **Client → on-chain** | Clients call contracts via standard EVM RPC. No direct client → backend → contract path that bypasses the user's signature. | Funds only move when the user (or their delegated AgentAccount session key) signs. |
| **Client / backend → spending key** | Spending keys are derived from the user's wallet signature in-browser. **Never** transmitted, stored on backend, or logged. | Core privacy guarantee. |
| **Backend → user secrets (full)** | Backend may receive a witness for server-assisted proving (one-operation secrets only). Backend may NOT receive the spending key. | Limits backend-compromise blast radius to one operation. |
| **Backend → on-chain admin** | Backend services have no admin role on any contract. All admin operations go through the Safe (S10). | Operational compromise can't escalate to fund movement. |
| **Circuit ↔ contract** | Circuits and contracts must use **identical leaf-computation recipes**. Both rely on `vkHash` pinned at contract construction. | Mismatch = silent verification failure or wrong-amount risk. |
| **Subgraph → write path** | Subgraph is read-only. Indexers may not initiate any state-changing call. | Read/write separation; no path for indexer compromise to move funds. |
| **MCP server → user-owned signatures** | MCP server receives signed userOps from agents; it does NOT generate signatures on a user's behalf. | Agent owns its key; MCP is just a tool surface. |
| **PrivacyEntry custody** | Only the pool contracts (with `POOL_ROLE`) can move tokens inside PrivacyEntry. No EOA, ever. | Custody is by-contract; admin can't directly drain. |

### 3.2 Boundaries that MAY be crossed (with caution)

| Boundary | Rule | Caution |
|---|---|---|
| **Client → backend (REST/MCP)** | Yes via the L5 API contract. | Auth required; rate-limited; idempotent action submission. |
| **Backend → external services** | Yes (Kurier, Goldsky, Stork, IPFS, KMS). | Only the approved services list. Outbound network egress is allowlist-only. |
| **Circuit → on-chain public inputs** | Yes; declared public inputs are revealed by definition. | Audit must verify ONLY declared public inputs leak. |
| **Agent → AgentAccount via bundler** | Yes; that's the whole point of ERC-4337 here. | Policy enforcement validates the userOp at contract level — no shortcuts. |

## 4. Invariants the codebase must never break

These are the **load-bearing assumptions** that the rest of the design
depends on. If any of these breaks, the protocol is unsafe.

### 4.1 Cryptographic invariants

- **I-CRYPTO-1**: Spending keys never appear in any on-chain transaction, log, server log, database column, or persisted client store.
- **I-CRYPTO-2**: Every nullifier is the deterministic output of `Poseidon(secret_key, salt)`. The `spent[nullifierHash]` mapping is checked before any state mutation that consumes a note.
- **I-CRYPTO-3**: Every commitment encodes a fresh `salt`. Salts are sampled from a CSPRNG; never reused across notes.
- **I-CRYPTO-4**: Every Merkle proof verifies against a root in the current `rootHistory` ring buffer; not against arbitrary roots.
- **I-CRYPTO-5**: `vkHash` for each circuit is pinned at contract construction; the contract refuses any proof not matching the pinned `vkHash`.

### 4.2 Solvency invariants (Aave-aligned)

- **I-SOLV-1**: For every asset, `appCustody[token]` ≥ `sum(active supply notes × supplyIndex)` − `deficit`.
- **I-SOLV-2**: `borrowIndex` and `supplyIndex` are non-decreasing across normal operations. The only way `supplyIndex` decreases is via the documented bad-debt-socialization path with `deficit > insuranceFundBalance`.
- **I-SOLV-3**: `borrowIndex × totalBorrow × (1 − reserveFactor) ≈ supplyIndex × totalSupply × growth − badDebt` (per asset, within rounding).
- **I-SOLV-4**: `reserveFactor[asset] < 10000` bps at all times. Setting it to ≥10000 would give lenders negative APR.
- **I-SOLV-5**: A position's resulting `healthFactor` must be ≥ 1.0 after any borrow / withdraw-collateral / position-loosening operation.

### 4.3 Access-control invariants

- **I-AC-1**: `ADMIN_ROLE` on every contract is held ONLY by the Den Safe address.
- **I-AC-2**: `MANAGER_ROLE` is held only by KMS-controlled keeper EOAs whose private keys never leave AWS KMS.
- **I-AC-3**: `GUARDIAN_ROLE` is held by exactly one hardware-wallet-backed key, with `pause()` as its only authorised action.
- **I-AC-4**: `POOL_ROLE` on PrivacyEntry is held ONLY by the deployed `ShieldedSupplyPool`, `ShieldedPositionPool`, and `LiquidationBoard` contracts. No EOA, no Safe.
- **I-AC-5**: No contract holds an admin role on itself or on another contract beyond what's documented.

### 4.4 Replay / idempotency invariants

- **I-REPLAY-1**: Every nullifier can be spent exactly once on chain.
- **I-REPLAY-2**: Every userOp signature includes domain separator + chainId; cross-chain replay is impossible.
- **I-REPLAY-3**: Every API intent has a server-stored idempotency key (24h TTL); resubmission returns the existing intent.
- **I-REPLAY-4**: Every aggregation tuple's `(domainId, aggregationId, leafIndex)` is recorded as consumed by the consuming contract; double-consumption rejected.

### 4.5 Privacy invariants

- **I-PRIV-1**: Per-user amounts (supply, debt, collateral) appear nowhere on chain in plaintext.
- **I-PRIV-2**: The user's `spending_pubkey` derives deterministically from a wallet signature; nothing about the wallet address can be inferred from the on-chain commitment.
- **I-PRIV-3**: Auditor-decryptable fields are populated ONLY when the user opts in at deposit time; default is no auditor-decryptability.
- **I-PRIV-4**: The subgraph indexes only on-chain data; it never receives a witness, a spending key, or a decrypted note.

### 4.6 Operational invariants

- **I-OPS-1**: No build is deployed to mainnet that did not pass the audit gate.
- **I-OPS-2**: All deployed contract bytecode matches a reproducible build artifact pinned in the `ProtocolArtifactRegistry`.
- **I-OPS-3**: Every state-mutating function is wearable a `whenNotPaused` modifier.
- **I-OPS-4**: Every state-mutating function is wearable a `nonReentrant` modifier.
- **I-OPS-5**: Test coverage for new contracts ≥ 95% line coverage before merge.

## 5. Out-of-scope tech (do NOT introduce)

The coding agent must not introduce any of these in v1 without explicit
user approval — they're out-of-scope by design choice:

- Custom blockchains / parachains (we use Horizen).
- Custom oracle networks (we use Stork).
- Custom indexers (we use Goldsky).
- Custom bridges (we use LayerZero OFTs as deployed).
- Custom token contracts (we use USDC + cbBTC + WETH + ZEN as already deployed).
- Proxy / upgradable contracts (per [S15](../subsystems/15_threat_model.md) §3 — no proxy in v1).
- AI/ML inside contracts (out of scope).
- VRF / randomness oracle (we don't need on-chain randomness in v1).
- Centralized order book (we are a lending market, not an exchange).

## 6. Test layers

| Layer | Framework | What it covers |
|---|---|---|
| Solidity unit tests | Foundry `forge test` | Per-contract invariants, edge cases, revert paths |
| Solidity fuzz tests | Foundry `forge test --fuzz` | Property-based: invariants hold under random inputs |
| Solidity invariant tests | Foundry `forge test --invariant` | Multi-call sequences preserve the S15 invariants |
| Circuit tests | `nargo test` + custom Node harness | Circuit produces valid proofs for known inputs; rejects malformed |
| Circuit fuzz | bespoke runner | 1000 random valid witnesses → 100% verify |
| Backend tests | Vitest / Mocha | Service layer, API handlers, DB queries |
| Integration tests | Foundry + Anvil + local subgraph | End-to-end on a local stack |
| Spike tests | Volta testnet | Real-network E2E (per `spikes/01_critical_path.md`) |
| Frontend tests | Vitest + Playwright | Component + E2E browser tests |
| Performance tests | k6 / custom load runner | SLO validation (S16) |

## 7. Repository layout (what the codebase will look like)

The implementation produces this layout. The coding agent creates files
within this layout — never outside it without flagging.

```
code/
├── contracts/                  # Foundry project for all Solidity
│   ├── src/
│   │   ├── AssetRegistry.sol
│   │   ├── PrivacyEntry.sol
│   │   ├── ShieldedSupplyPool.sol
│   │   ├── ShieldedPositionPool.sol
│   │   ├── LiquidationBoard.sol
│   │   ├── RateModel.sol
│   │   ├── Oracle.sol
│   │   ├── ZkVerifier.sol
│   │   ├── InsuranceFund.sol
│   │   ├── AuditorRegistry.sol
│   │   ├── AgentAccount.sol
│   │   └── PolicyRegistry.sol
│   ├── test/
│   ├── script/
│   └── foundry.toml
├── circuits/                   # Noir project
│   ├── crates/
│   │   ├── entry_deposit/
│   │   ├── entry_withdraw/
│   │   ├── supply_asset/
│   │   ├── withdraw_supply/
│   │   ├── deposit_collateral/
│   │   ├── withdraw_collateral/
│   │   ├── borrow/
│   │   ├── repay/
│   │   ├── liquidate/
│   │   ├── consolidate_balance/
│   │   └── compute_triggers/
│   └── Nargo.toml
├── backend/                    # Node services
│   ├── api-server/             # REST + MCP
│   ├── prover-service/         # server-side proving
│   ├── keeper/                 # price + accrue + backstop
│   └── shared/
├── subgraph/                   # Goldsky subgraph project
│   ├── schema.graphql
│   ├── subgraph.yaml
│   └── src/mappings/
├── dapp/                       # Next.js human frontend
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── public/
├── sdk-ts/                     # @lending/sdk-ts npm package
├── sdk-py/                     # lending-agent-py PyPI package
├── ops/                        # Docker + IaC + runbooks
│   ├── docker/
│   ├── terraform/
│   └── runbooks/
└── docs/                       # Generated; design docs stay in design-v2/
```

## 8. Versioning and branches

- `main` branch is always deployable to testnet.
- Feature branches: `feat/<subsystem>-<short-description>` (e.g., `feat/s01-asset-registry`).
- PRs from feature branches; CI required to pass before merge.
- Releases tagged as `v0.1.0-day-NN-spike` for daily roadmap milestones.
- Mainnet candidates tagged `v1.0.0-rc-N`.

## 9. Cross-references

- Full subsystem docs: `../subsystems/01_*.md` through `17_*.md`
- API spec source: `../subsystems/13_api_contract.md`
- Threat model: `../subsystems/15_threat_model.md`
- Performance SLOs: `../subsystems/16_performance.md`
- Coding standards: `code_standard.md`
- AI coding rules: `agent_workflow_rules.md`
- 21-day roadmap: `code_roadmap.md`
