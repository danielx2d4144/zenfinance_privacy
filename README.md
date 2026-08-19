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

**Current Phase:** Phase 2 completion - VK format fixed, pending contract redeployment + live proof testing  
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

## Supported Assets (Testnet)

| Token | Role | Type |
|-------|------|------|
| USDC | Primary supply/borrow asset | ERC20 (testnet) |
| ZEN | Native collateral (wrapped) | ERC20 (testnet) |
| WETH | Alternative collateral | ERC20 (testnet) |

**Note:** Testnet versions of these tokens. More assets may be added based on testnet feedback.

---

## Typical User Journey

1. **User deposits 1000 USDC** via PrivacyEntry. Proof generated client-side (browser). USDC locked in contract, commitment stored in Merkle tree.

2. **User supplies USDC to lending pool.** Supply proof generated. Old commitment nullified, new commitment created with accrued interest.

3. **User deposits ZEN collateral.** Collateral commitment created privately.

4. **User borrows 500 USDC against ZEN.** Borrow proof checks collateralization. New debt commitment created.

5. **User repays 500 USDC.** Repayment proof. Debt commitment nullified.

6. **User withdraws 1000 USDC + interest.** Withdrawal proof. USDC transferred to wallet, nullifier published.

**Privacy at every step:** No on-chain observer sees balances, loan amounts, or health factors.

---

## Documentation

- **[Current Status](NEXT_STEPS.md)** — project status and next steps
- **[Ground Truth](GROUND_TRUTH.md)** — canonical project state (technical details)
- **[Architecture Overview](docs/ARCHITECTURE.md)** — system design and data flow
- **[Deployment Addresses](docs/DEPLOYMENTS.md)** — testnet contracts and VK hashes
- **[Glossary](GLOSSARY.md)** — technical term definitions
- **[Changelog](CHANGELOG.md)** — version history

**Implementation Patterns:**
- **[Zendex Patterns](docs/ZENDEX_PATTERNS_ANALYSIS.md)** — production patterns from Horizen ecosystem
- **[Layrs Patterns](docs/LAYRS_PATTERNS_ANALYSIS.md)** — privacy patterns from prediction market

---

## Quick Start (Developers)

**Prerequisites:**
- Node.js 22+
- Rust stable
- Foundry
- Noir 1.0.0-beta.18

**Setup:**
```bash
git clone https://github.com/noctfinance/noctfinance.git
cd noctfinance
npm install

# Build circuits
cd code/circuits
nargo compile --workspace

# Run contract tests
cd ../contracts
forge test

# Start local development
cd ../dapp
npm run dev
```

See [Developer Guide](docs/DEVELOPER_GUIDE.md) for full setup instructions.

---

## Contributing

We welcome contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Code style guidelines
- Testing requirements
- PR process
- Circuit change checklist

---

## Security

**Responsible Disclosure:** security@noctfinance.xyz

Please do NOT file public GitHub issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for our security model and disclosure policy.

**Audit Status:** Pre-audit testnet phase. External audit planned before mainnet launch.

**Bug Bounty:** Not yet active (testnet phase).

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

MIT License — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

Built with:
- [Noir](https://noir-lang.org/) by Aztec
- [zkVerify](https://zkverify.io/) by Horizen Labs
- [Barretenberg](https://github.com/AztecProtocol/barretenberg) by Aztec

Special thanks to the Horizen team for zkVerify support and guidance.

---

**NoctFinance** — Privacy-preserving DeFi on Horizen  
Website: [noctfinance.xyz](https://noctfinance.xyz) (coming soon)  
Twitter: [@NoctFinance](https://twitter.com/NoctFinance) (coming soon)  
Discord: [discord.gg/noctfinance](https://discord.gg/noctfinance) (coming soon)
