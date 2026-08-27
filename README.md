# NoctFinance

**Privacy-preserving lending protocol on Horizen**

> Deposit, supply, borrow and liquidate cryptocurrency without revealing your balances, positions, or identity.

---

## What Is NoctFinance?

NoctFinance is a privacy-first lending protocol where all operations are wrapped in Zero-Knowledge Proofs verified by zkVerify and settled on Horizen.

Unlike Aave or Compound where every transaction is public, NoctFinance keeps your financial activity private:

| Public lending protocols | NoctFinance |
|-------------------------|-------------|
| Balances visible on-chain | Balances hidden in cryptographic commitments |
| Loan amounts are public | Amounts encoded in private ZK proofs |
| Positions can be tracked | Deposits and withdrawals are cryptographically unlinkable |
| Liquidations reveal portfolio | Liquidations prove insolvency without revealing full position |

---

## Live Deployment

| Network | Chain ID | Status |
|---------|----------|--------|
| **Horizen Testnet** | 2651420 | 🟡 Testing Phase |

**Current release:** v3.0 — deployed 2026-08-24 at block 26008305, with Stork oracle integration.

| Contract | Address |
|----------|---------|
| PrivacyEntry | `0xF774Ef76f52C819aA1cD14385F4D4Bc04Ec8E14b` |
| ShieldedSupplyPool | `0xd3900432F473f9367DC837d403Dd04D3Dd629db0` |
| ShieldedPositionPool | `0x42e8e79a7C0071930dAb7569100a7B4f4A674d09` |
| LiquidationBoard | `0x139f5D6316f5c9C95Bb6070cC2710dBBD4a8C173` |
| ZkVerifier | `0x8c8C4c860EF9749D7BaF82C35ef78232BDbd5077` |
| Oracle | `0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2` |
| RateModel | `0xD03cE597a99Da3BA67e0D46c1d0243Cd5600F4f9` |
| AssetRegistry | `0xDF0f2F7BF0D4eC09871E2cb1b10648561492dBff` |
| InsuranceFund | `0x0b0995aBb1240B3B6a2aF98658a94549998ffCbd` |
| MockUSDC | `0xdE21524EADf00d726a69Ac5Ebd97cE02735d8391` |
| MockCBBTC | `0xaC9AB44D3233de8CFD560E5a31Ec9AC4678c0e79` |
| Stork (external) | `0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62` |
| zkVerify aggregation proxy | `0x3098A6974649478f0133046e44105AA84e868C21` |

Full manifest: `code/contracts/deployments/horizen-testnet-2651420-v3-stork.json`

**Testnet deployment** — contract addresses and parameters subject to change before mainnet.

---

## Core Technologies

**UltraHonk Proofs via Noir + Barretenberg** as the privacy engine. NoctFinance uses UltraHonk (a modern ZK proving system) to generate compact proofs verified on-chain. Circuits are written in Noir, and proofs use the **Keccak oracle hash format (1888 bytes)** required by zkVerify.

**Poseidon2 Hash** optimized for ZK circuits. Used to seal private data (balances, spending keys, salts) into short commitments inside the circuits. The **circuit outputs** use Poseidon2, but the **proof transcripts** use Keccak for zkVerify compatibility.

**Incremental Merkle Tree** stores all user commitments. Allows proving a commitment exists without revealing what others are.

**zkVerify Aggregation** batches multiple proofs for efficient on-chain verification on Horizen.

**EVM-Compatible** — deployed on Horizen testnet, going live on Horizen mainnet post-testnet phase.

---

## How NoctFinance Works

**Core Concept:** Instead of storing token balances on-chain, NoctFinance stores a cryptographic commitment to your balance. Only you (via your spending key) know the secret values behind that commitment.

Every operation requires producing a ZK proof that you know the right secrets — verified on-chain via zkVerify without revealing those secrets.

### The Commitment

```
commitment = Poseidon2(
  asset_id,
  amount,
  Poseidon2(salt, spending_key)
)
```

Stored on-chain in a Merkle tree. Cannot be reverse-engineered to reveal balance or identity.

### The Nullifier

```
nullifier = Poseidon2(
  commitment,
  spending_key
)
```

Published on-chain when a commitment is spent. Prevents double-spending without revealing which commitment was spent or who owned it.

---

## The Four Core Operations

### 1. Deposit (Entry)
Lock tokens into the protocol, receive a private commitment. After confirmation, your balance is hidden.

### 2. Supply
Deposit collateral into the lending pool. LP interest accrues to your private commitment.

### 3. Borrow
Borrow against your collateral privately. Loan amount and health factor remain hidden.

### 4. Withdraw
Prove ownership of a commitment, reclaim tokens. Nullifier published to prevent double-withdrawal.

**Additional operations:** Repay loans, liquidate undercollateralized positions, consolidate commitments.

All operations require valid ZK proofs verified on-chain via zkVerify → Horizen.

---

## Privacy Guarantees

**Balance Privacy:** User balances are never stored on-chain, only cryptographic commitments.

**Amount Privacy:** Transaction amounts are private inputs to ZK circuits, not public.

**Transaction Unlinkability:** Deposits and withdrawals cannot be linked by on-chain observers.

**Position Privacy:** Loan-to-value ratios and health factors are computed in ZK proofs, not revealed publicly.

**Recovery from Spending Key:** If you lose access to your wallet, you can recover all commitments from your spending key alone.

### Explicit Exclusions

- **Deposit addresses are public:** The wallet you deposit from is visible on-chain.
- **Transaction timing is public:** When you perform an operation is visible.
- **Network-level anonymity:** Requires Tor or VPN for IP privacy.
- **Smart contract events:** Events are emitted (but data is encrypted/hashed).

---

## ZK Circuit Architecture

NoctFinance uses **11 Noir circuits** verified by UltraHonk + zkVerify:

| Circuit | What it proves |
|---------|---------------|
| `entry_deposit` | Correct deposit commitment formation |
| `entry_withdraw` | Ownership + nullifier validity on withdrawal |
| `supply_asset` | Valid private supply to lending pool |
| `withdraw_supply` | Valid private withdrawal from pool |
| `deposit_collateral` | Valid collateral deposit |
| `withdraw_collateral` | Valid collateral withdrawal with health check |
| `borrow` | Valid borrow with collateralization check |
| `repay` | Valid loan repayment |
| `liquidate` | Valid liquidation of undercollateralized position |
| `consolidate_balance` | Merge multiple commitments into one |
| `compute_triggers` | Compute interest accrual and health factors |

All circuits use **Keccak oracle hash** for proof transcripts (zkVerify requirement) while using **Poseidon2 internally** for efficient commitment computation.

---

## Smart Contract Architecture

```
NoctFinance
│
├── POOL CONTRACTS
│   ├── ShieldedSupplyPool      ← private lending pool (supply/withdraw supply)
│   ├── ShieldedPositionPool    ← private positions (collateral/borrow/repay)
│   ├── LiquidationBoard        ← liquidation discovery + execution
│   ├── AssetRegistry           ← asset configuration
│   ├── RateModel               ← utilization-based interest rates
│   └── InsuranceFund           ← bad debt coverage
│
├── PRIVACY CONTRACTS
│   └── PrivacyEntry            ← deposit/withdraw with commitments + IMT
│
├── VERIFICATION
│   ├── ZkVerifier              ← zkVerify aggregation proof verification
│   └── VkRegistry (library)    ← pins circuit VK hashes (Keccak format)
│
├── ACCOUNT ABSTRACTION
│   ├── AgentAccount            ← ERC-4337 smart accounts (future use)
│   └── PolicyRegistry          ← delegation policies (future use)
│
└── ORACLES
    └── Oracle                  ← Stork price feeds
```

All contracts verified on Horizen block explorer.

---

## Repository Layout

```
code/
├── circuits/          11 Noir circuits + lib_common (shared Poseidon2 helpers)
├── contracts/         Foundry project — pools, PrivacyEntry, ZkVerifier, Oracle
├── dapp/              Next.js 16 frontend; proves in-browser via bb.js
├── backend/
│   ├── data-api/      Fastify REST + MCP relayer: accepts proofs, submits on-chain
│   ├── prover-service/ Kurier submission + aggregation polling (data-api dep)
│   ├── price-keeper/   Pushes Stork/manual prices to keep the Oracle fresh
│   └── subgraph/      Graph Protocol indexer for events
├── sdks/              sdk-ts, sdk-py client libraries
└── infra/             docker-compose data stack (Postgres, IPFS, graph-node, Anvil)
```

### Off-chain services

**data-api** (`code/backend/data-api`) — the relayer. Browsers post proofs and
public inputs here; it forwards them through prover-service to Kurier, waits for
zkVerify aggregation, then submits the settlement transaction on Horizen using
the funded relayer key. Users never pay gas directly and never expose their
spending key. Requires Postgres for intent tracking and resume-after-restart.

**prover-service** (`code/backend/prover-service`) — Kurier client. Submits
UltraHonk proofs to zkVerify's REST API, polls for the aggregation receipt, and
returns the Merkle path the on-chain `ZkVerifier` needs. Consumed by data-api as
a `file:` dependency, so it must be built first.

**price-keeper** (`code/backend/price-keeper`) — keeps `Oracle.getPrice()` from
going stale. In hybrid mode it re-pushes manual prices; once Stork enables
Horizen feeds it will push signed Stork updates instead.

### Client-side proving and note recovery

Proofs are generated in the browser with `@aztec/bb.js` — private witnesses never
leave the device. Notes are stored in IndexedDB, but all state is derivable from
the spending key alone: on unlock, the dapp scans from
`NEXT_PUBLIC_HORIZEN_DEPLOY_BLOCK` forward, decrypts memo fields on
`Deposited`/`SupplyDeposited`/`PositionUpdated` events, and **rehydrates the
local Incremental Merkle Trees** in leaf-index order so Merkle paths match the
on-chain root. This is what makes cross-session operations work — deposit in one
session, supply in another.

If a local tree ever desyncs (typically after a redeploy leaves stale IndexedDB
state), clearing storage and re-unlocking rebuilds it from chain. See
[IMT-SYNC-FIX.md](IMT-SYNC-FIX.md).

---

## Supported Assets (Testnet)

Asset IDs are positional and must match `AssetRegistry` on-chain, the circuit
witness builders, and the relayer handlers. Slots 2 and 3 are reserved but not
yet registered on testnet.

| Asset ID | Token | Role | Type |
|----------|-------|------|------|
| 0 | USDC | Primary supply/borrow asset | ERC20 (mock, testnet) |
| 1 | cbBTC | Primary collateral | ERC20 (mock, testnet) |
| 2 | WETH | Reserved — not registered | — |
| 3 | ZEN | Reserved — not registered | — |

**Note:** Testnet tokens are mocks with open `mint()`. More assets may be added
based on testnet feedback.

---

## Price Oracle (Hybrid Mode)

v3.0 integrates the Stork oracle, but Stork does not yet publish USDC or BTC
feeds on Horizen testnet — querying it reverts with `0xc5723b51`. The Oracle
therefore runs in **hybrid mode**:

- Stork feed IDs are set to `bytes32(0)`, so `getPrice()` falls back to manual
  prices in the `_priceData` mapping.
- An address with `MANAGER_ROLE` pushes prices via `pushPrice(assetId, price)`.
- **Prices expire after 1 hour** (3600s staleness window). Stale prices make
  supply and borrow revert with `PriceStale` (`0x0868dfcf`).

Refresh prices before testing:

```bash
cd code/contracts
forge script script/RefreshOraclePrices.s.sol \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --broadcast --legacy
```

Details and the migration path to full Stork: [ORACLE-HYBRID-MODE.md](ORACLE-HYBRID-MODE.md)

---

## Typical User Journey

1. **User deposits 1000 USDC** via PrivacyEntry. Proof generated client-side (browser). USDC locked in contract, commitment stored in Merkle tree.

2. **User supplies USDC to lending pool.** Supply proof generated. Old commitment nullified, new commitment created with accrued interest.

3. **User deposits cbBTC collateral.** Collateral commitment created privately.

4. **User borrows 500 USDC against cbBTC.** Borrow proof checks collateralization. New debt commitment created.

5. **User repays 500 USDC.** Repayment proof. Debt commitment nullified.

6. **User withdraws 1000 USDC + interest.** Withdrawal proof. USDC transferred to wallet, nullifier published.

**Privacy at every step:** No on-chain observer sees balances, loan amounts, or health factors.

---

## Documentation

- **[Local Setup](LOCAL-SETUP.md)** — run the whole stack on your own machine
- **[Current Status](NEXT_STEPS.md)** — project status and next steps
- **[Ground Truth](GROUND_TRUTH.md)** — canonical project state (technical details)
- **[Architecture Overview](docs/ARCHITECTURE.md)** — system design and data flow
- **[Deployment Addresses](docs/DEPLOYMENTS.md)** — testnet contracts and VK hashes
- **[Oracle Hybrid Mode](ORACLE-HYBRID-MODE.md)** — price feed configuration
- **[Bug Tracker](BUG-TRACKER.md)** — known issues with root-cause analysis
- **[Glossary](GLOSSARY.md)** — technical term definitions
- **[Changelog](CHANGELOG.md)** — version history

---

## Quick Start (Developers)

**Prerequisites:** Node.js 22.x, Foundry, Noir/nargo 1.0.0-beta.18 + bb 3.0.0-rc.6, Docker, Rust stable.

```bash
git clone https://github.com/danielx2d4144/zenfinance_privacy.git
cd zenfinance_privacy

# 1. Compile circuits
cd code/circuits && nargo compile --workspace && cd ../..

# 2. Contract tests
cd code/contracts && forge build && forge test && cd ../..

# 3. Relayer (prover-service must build first — data-api depends on it)
cd code/backend/data-api
cp .env.horizen .env.local-horizen   # then fill in your own keys
npm install && npm run build
npm run migrate:up
npm start                            # http://127.0.0.1:8787

# 4. Frontend (separate terminal)
cd code/dapp
npm install && npm run dev           # http://localhost:3000
```

**Full step-by-step instructions, including the local Anvil stack, Postgres
setup, environment variables, funding a testnet wallet, and troubleshooting:
[LOCAL-SETUP.md](LOCAL-SETUP.md)**

---

## Contributing

Contributions are welcome. Before opening a PR:

- Run `forge test` (contracts) and `npm test` in `code/dapp` and `code/backend/data-api`.
- If you change a circuit, recompile it, regenerate the VK, and update the
  matching hash in **both** `code/contracts/src/VkRegistry.sol` and
  `code/backend/data-api/src/vk-registry.ts`. A mismatch between these two is
  the single most common cause of `VkHashMismatch` at settlement time.
- Match the surrounding code style; the codebase favors explanatory comments on
  non-obvious cryptographic steps.

---

## Security

**Responsible disclosure:** security@noctfinance.xyz

Please do NOT file public GitHub issues for security vulnerabilities.

**Audit status:** Pre-audit testnet phase. External audit planned before mainnet launch.

**Bug bounty:** Not yet active (testnet phase).

⚠️ Testnet keys, mock tokens, and manually-pushed oracle prices are in use. Do
not treat this deployment as production-secure, and never reuse a testnet
private key on mainnet.

---

## Glossary

| Term | Explanation |
|------|-------------|
| **ZK Proof** | Mathematical proof of knowledge without revealing the secret |
| **UltraHonk** | Modern ZK proving system with no per-circuit trusted setup |
| **Noir** | Domain-specific language for writing ZK circuits |
| **Commitment** | Cryptographic seal on private data (balance, spending key, salt) |
| **Nullifier** | One-time code preventing double-spending of commitments |
| **Merkle Tree** | Data structure proving membership without revealing others |
| **Poseidon2** | Hash function optimized for ZK circuits |
| **zkVerify** | Horizen's proof aggregation and verification layer |
| **Kurier** | zkVerify's REST API for proof submission |
| **Spending Key** | Secret key controlling commitments (like a private key) |
| **Keccak VK** | 1888-byte verification key format for on-chain verification |

Full glossary: [GLOSSARY.md](GLOSSARY.md)

---

## License

MIT License.

---

## Acknowledgments

Built with:
- [Noir](https://noir-lang.org/) by Aztec
- [zkVerify](https://zkverify.io/) by Horizen Labs
- [Barretenberg](https://github.com/AztecProtocol/barretenberg) by Aztec

Special thanks to the Horizen team for zkVerify support and guidance.

---

**NoctFinance** — Privacy-preserving DeFi on Horizen  
Website: [noctfinance.xyz](https://noctfinance.xyz)  
Twitter: [@Noct_finance](https://twitter.com/Noct_finance)
