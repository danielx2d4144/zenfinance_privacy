# Privacy Lending Protocol v2 — Human + Agent Accessible

> **Status:** design folder for the **practical, ZK-based, agent-first** revision
> of the privacy lending protocol. Supersedes the VELA-based design in
> `../design/`, which is preserved for historical reference.

## The pivot in one paragraph

We drop VELA (TEE-confidential state, not in production) and pivot to a
**Tornado-Nova-style shielded pool with client-side ZK proofs and zkVerify
aggregation**, extended into a **multi-asset lending protocol** where users
can supply and borrow any of {USDC, cbBTC, WETH, ZEN} against any
combination of the others. Privacy comes from commitments + nullifiers +
ZK; lending arithmetic comes from Aave v3's well-tested multi-asset model.
**Everything we use is already proven by the JetHalo reference dapps
(`zk-Escrow`, `zkp2p-demo`, `zkvote`) on the exact same Horizen + zkVerify
stack we'll ship on.**

We **add a first-class agent layer**: ERC-4337 smart accounts with
per-asset delegation, a typed REST API and an MCP server so LLM-driven
agents can operate the protocol within owner-defined per-asset policies.
AI agents are a major DeFi user category and their needs are different
enough from human UX that treating them as a bolt-on would compromise both.

We **add a Privacy Entry layer** (subsystem 12): users fund once, withdraw
once, and every supply / borrow / repay / liquidate in between is invisible
on their external wallet — same model as Aztec Connect.

**v1 launch scope:** USDC + cbBTC only. The multi-asset architecture is
in place from day one; WETH + ZEN markets are enabled via Safe-driven
parameter governance in v1.1 / v1.2, no contract redeployment required.

## What's different from v1 (the `../design/` folder)

| Concern | v1 (VELA-based) | v2 (ZK + agent-first) |
|---|---|---|
| Privacy mechanism | TEE-confidential state in AWS Nitro Enclave | Client-side ZK proofs + commitments in a Merkle tree |
| Trust root | Enclave attestation + AWS Nitro CRL | Pure math (Groth16 / UltraHonk verifying keys) |
| State location | Encrypted state in Manager's LevelDB | Notes held by users; only commitments + nullifiers on chain |
| User identity | Wallet address visible at every request | Pseudonymous spending-key; addresses unlinkable |
| Borrowing latency | ECDSA path: <1 min; high-value: 2-10 min | All paths: ~3-5 min (Kurier aggregation) |
| Liquidation discovery | Enclave emits `LiquidationOpportunity` AppEvent | Public `liquidationPrice` per position (k-anonymity bucket) |
| Implementation risk | Blocked on VELA reaching production + 3 open Q1 questions | All components proven on Horizen Testnet today |
| Agent accessibility | Not designed in | First-class: REST + MCP + smart accounts |
| Audit scope | 8 contracts + WASM app + Manager + Executor | 6 contracts + 7 circuits + 1 agent runtime |
| **Estimated time to audited mainnet** | **blocked + unknown** | **6-9 months** |

## Components, at a glance

```
On-chain (Horizen):
  ShieldedSupplyPool.sol    - USDC pool: Merkle tree of lender notes
  ShieldedBorrowPool.sol    - cbBTC pool: Merkle tree of borrower notes
  RateModel.sol             - public supplyIndex + borrowIndex
  LiquidationBoard.sol      - public liquidationPrice per position
  Oracle.sol                - Stork wrapper
  ZkVerifier.sol            - thin IVerifyProofAggregation calls

Smart accounts (Horizen):
  AgentAccount.sol          - ERC-4337 smart account with bounded delegation
  PolicyRegistry.sol        - owner-signed policies governing agent actions

Off-chain client side:
  Noir circuits             - deposit_supply, withdraw_supply, deposit_collateral,
                              borrow, repay, withdraw_collateral, liquidate
  Browser prover            - @aztec/bb.js running UltraHonk in WASM
  Node SDK                  - same prover, server-side
  MCP server                - exposes typed actions to LLM agents

Off-chain we operate:
  Indexer (Goldsky)         - subgraph over all on-chain state
  REST API                  - structured market data + position queries for agents
  Keepers                   - Stork pusher, accrual poker, backstop liquidator
  Note backup (optional)    - encrypted-to-wallet IPFS backup service

Frontends:
  Human dapp                - Next.js, browser prover, MetaMask-flow
  Agent runtime             - TS template (LangChain/Mastra compatible) +
                              Python SDK + MCP server
```

## The two-track user story

**Human:** "I want to deposit 50,000 USDC and earn yield, and separately borrow against my 1 cbBTC without revealing the size of my position." → connects MetaMask, clicks Deposit, waits ~3 min for the first proof, sees their (private) position render after note decryption.

**Agent (LLM-orchestrated treasury operator):** runs in a server, holds a delegated session key on the user's `AgentAccount`, has policy "borrow up to $500k USDC against any collateral the owner deposits, never let HF drop below 2.0, repay everything if cbBTC drops below $50k." LLM calls our MCP server's `getMarketStatus`, `getPosition`, `proposeBorrow`, `submitBorrow`, etc. Proofs generate server-side via the Node SDK.

Both tracks use the **same shielded pool** and **same circuits**. They differ only in the client-side machinery around proof generation and authentication.

## Read order for the rest of this folder

1. **`architecture_overview.md`** — the full system picture.
2. **`subsystems/01_shielded_pools.md` … `10_artifact_distribution.md`** — one per subsystem (numbered for ordering).
3. **`integration.md`** — how the 10 subsystems compose.

## Open questions intentionally left at design time

These need testnet spikes before contract code, but **none of them block design** (unlike v1's Q1.1/Q1.2/Q1.3 which depend on TEE infrastructure that may not exist):

- Exact `bb` toolchain pin (current zkVerify support is `bb >= 3.0.0`, UltraHonk ZK flavour with Keccak transcript — spike on Volta to confirm circuit sizes fit).
- ERC-4337 entry point on Horizen — does Caldera deploy the canonical one (`0x4337…`)? If not, we'd deploy our own.
- Anonymity-set bootstrapping — at launch with <10 users, positions are de-facto identifiable. Standard cold-start problem; mitigated by founder/treasury seeding the pool.
- Browser-side proof generation time for the borrow circuit — needs to stay under 10s for acceptable UX. Likely fine for ~5k-constraint circuits but needs measurement.

Everything else is implementable from day one.
