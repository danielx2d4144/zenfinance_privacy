# NoctFinance Glossary

Technical terms and concepts used throughout the NoctFinance documentation.

---

## Zero-Knowledge Proofs

**ZK Proof (Zero-Knowledge Proof)**  
A cryptographic method that lets you prove you know something (e.g., "I have 1000 USDC") without revealing the actual information (the exact amount or your identity). Used in every NoctFinance operation.

**UltraHonk**  
The modern ZK proving system used by NoctFinance. Produces compact proofs and supports fast on-chain verification. Does not require a per-circuit trusted setup, making it more flexible than older systems like Groth16.

**Noir**  
A domain-specific programming language for writing ZK circuits. NoctFinance's 11 circuits are written in Noir, compiled to bytecode, then proved using Barretenberg.

**Barretenberg**  
Aztec's ZK proving library that generates and verifies UltraHonk proofs. Runs in the browser via WebAssembly for client-side proving.

**Circuit**  
A program written in Noir that defines what gets proven. Each circuit has public inputs (visible on-chain) and private inputs (kept secret). NoctFinance has 11 circuits covering all operations.

**Witness**  
The set of private inputs to a ZK circuit. For example, the supply_asset witness includes your old balance, new balance, salt values, and spending key — all kept private.

**Public Inputs**  
Values that are revealed on-chain as part of a ZK proof. For supply_asset, these include the asset ID, root commitment, and nullifier — but not your actual balance.

**VK (Verification Key)**  
A cryptographic key derived from a circuit's bytecode, used to verify proofs on-chain. NoctFinance uses 1888-byte Keccak-format VKs compatible with zkVerify.

**Proof**  
The output of running a ZK circuit with a witness. A proof is typically ~200KB and proves "I executed this circuit correctly with valid private inputs" without revealing those inputs.

---

## Privacy Primitives

**Commitment**  
A cryptographic "seal" on private data. In NoctFinance:
```
commitment = Poseidon2(asset_id, amount, Poseidon2(salt, spending_key))
```
Stored on-chain but cannot be reverse-engineered to reveal the balance or owner.

**Nullifier**  
A one-time code published when a commitment is spent. Prevents double-spending. In NoctFinance:
```
nullifier = Poseidon2(commitment, spending_key)
```
Once a nullifier appears on-chain, that commitment can never be spent again.

**Salt (Blinding Factor)**  
A random value added to commitments to prevent brute-force guessing. Even if an attacker knows your spending key and asset ID, they can't compute your commitment without the salt.

**Spending Key**  
Your secret key that controls all your commitments. Like a private key, but specifically for ZK operations. You can recover all your commitments from your spending key alone.

**Unlinkability**  
The property that deposits and withdrawals cannot be connected by on-chain observers. NoctFinance deposits create commitments that look random; withdrawals publish nullifiers that don't reveal which commitment was spent.

---

## Data Structures

**Merkle Tree**  
A tree-shaped data structure that efficiently proves membership. NoctFinance stores all commitments in a Merkle tree, allowing you to prove "my commitment is in the tree" without revealing what other commitments exist.

**Merkle Root**  
The single hash at the top of a Merkle tree. Represents the entire tree's state. When you prove a commitment exists, you prove it relative to a specific root.

**Merkle Proof (Siblings)**  
The sibling hashes needed to reconstruct the path from your commitment to the root. Typically 20 hashes for a tree of depth 20 (supports up to ~1 million commitments).

**IMT (Indexed Merkle Tree)**  
A Merkle tree variant where commitments are inserted at specific indices, not just appended. NoctFinance uses IMTs for balance and supply commitments.

**Epoch**  
A snapshot of the Merkle tree state at a specific block. Used to scope inclusion proofs — "commitment X existed in the tree at epoch Y."

---

## Hash Functions

**Poseidon2**  
A cryptographic hash function optimized for ZK circuits. Much more efficient than SHA-256 or Keccak inside a circuit. NoctFinance uses Poseidon2 for all commitment and nullifier computations.

**Keccak-256**  
A hash function used in Ethereum. NoctFinance uses Keccak for VK hashing (required by zkVerify) but Poseidon2 inside circuits.

**Oracle Hash**  
The hash function used by a ZK proving system internally. NoctFinance uses "Keccak oracle hash" (not Poseidon2) to generate 1888-byte VKs compatible with zkVerify.

---

## zkVerify & Horizen

**zkVerify**  
Horizen's proof verification and aggregation layer. Instead of verifying proofs directly on Horizen (expensive), zkVerify batches multiple proofs and publishes a single aggregation proof on-chain.

**Kurier**  
zkVerify's REST API for submitting proofs. NoctFinance's data-api submits UltraHonk proofs to Kurier, which verifies them and returns a job ID.

**Aggregation**  
The process of combining many ZK proofs into one. zkVerify aggregates proofs from multiple protocols, then publishes a single proof to Horizen that covers all of them.

**Attestation**  
The on-chain record of a verified proof. After zkVerify aggregates your proof, the attestation is published to Horizen's ZkVerifier contract.

**Domain**  
A zkVerify namespace for grouping proofs. NoctFinance uses domain 175 on Horizen testnet.

**Proof Consumed Event**  
The on-chain event emitted after a proof is verified. NoctFinance's Pool contract listens for ProofConsumed events to finalize supply/borrow operations.

---

## Lending Concepts

**Supply**  
Depositing assets into the lending pool to earn interest. In NoctFinance, your supply commitment accrues interest over time, updated via consolidate_balance proofs.

**Borrow**  
Taking a loan against collateral. NoctFinance's borrow circuit checks that your collateral commitment is sufficient before creating a debt commitment.

**Collateral**  
Assets deposited to secure a loan. In NoctFinance, collateral is stored as a private commitment — liquidators can prove you're undercollateralized without seeing your exact balance.

**LTV (Loan-to-Value)**  
The ratio of your loan to your collateral value. For example, if you borrow 500 USDC against 1 ETH worth $2000, your LTV is 25%.

**Liquidation**  
Forced repayment of an undercollateralized loan. NoctFinance's liquidate circuit proves your health factor is below 1.0 without revealing your full position.

**Health Factor**  
A measure of loan safety: `health_factor = collateral_value / (debt_value * liquidation_threshold)`. If health factor < 1.0, you can be liquidated.

**Interest Rate Model**  
A formula that determines borrow/supply rates based on pool utilization. NoctFinance uses a kinked model: low rates at low utilization, steep increase near 100%.

---

## Smart Contract Patterns

**UUPS (Universal Upgradeable Proxy Standard)**  
An upgrade pattern where logic contracts can be replaced without changing the contract address. NoctFinance's Pool is UUPS upgradeable.

**Proxy**  
A contract that delegates calls to an implementation contract. Users interact with the proxy address, which never changes even when logic is upgraded.

**Implementation**  
The contract containing the actual logic. Can be upgraded by the proxy admin without disrupting users.

**Diamond Pattern**  
A modular contract design where functionality is split across "facets." NoctFinance doesn't use this (uses UUPS instead), but it's mentioned in contract architecture discussions.

---

## Development Tools

**Foundry**  
A fast Solidity development framework. NoctFinance uses `forge` for contract testing and `cast` for contract interactions.

**Noir Compiler (nargo)**  
The compiler for Noir circuits. `nargo compile` produces circuit bytecode; `nargo prove` generates proofs (though NoctFinance uses bb.js instead).

**bb.js**  
JavaScript/TypeScript bindings for Barretenberg. NoctFinance uses bb.js 3.0.x in the browser to generate UltraHonk proofs client-side.

**bb CLI**  
Command-line version of Barretenberg. Used for debugging and VK generation outside the browser.

**Next.js**  
React framework for building the NoctFinance dapp. Uses App Router with server components for the UI.

**Fastify**  
Node.js web framework used for NoctFinance's data-api and prover-service backends.

---

## Security & Cryptography

**Trusted Setup**  
A one-time ceremony required by some ZK systems (like Groth16) to generate proving/verification keys. UltraHonk does NOT require a trusted setup, making it safer.

**Collision Resistance**  
The property that it's computationally infeasible to find two different inputs that hash to the same output. NoctFinance's security assumes Poseidon2 is collision-resistant.

**Preimage Resistance**  
The property that it's computationally infeasible to reverse a hash (find an input that produces a given output). Prevents attackers from reversing commitments.

**Soundness**  
The property that a malicious prover cannot create a valid proof for a false statement. UltraHonk is provably sound under standard cryptographic assumptions.

**Completeness**  
The property that an honest prover can always create a valid proof for a true statement. NoctFinance's circuits are designed to be complete.

---

## Protocol Governance

**Admin**  
The privileged address that can upgrade contracts, add assets, and adjust parameters. In production, this will be a multisig or governance contract.

**Timelock**  
A delay between proposing and executing admin actions. Gives users time to exit if they disagree with a change. Not yet implemented in NoctFinance.

**Multisig**  
A wallet requiring multiple signatures to execute transactions. Often used for admin roles in production.

**Governance Token**  
A token that gives holders voting power over protocol parameters. NoctFinance does not currently have a governance token.

---

## Network & Infrastructure

**Horizen Testnet**  
Horizen's EVM-compatible testnet (chain ID 2651420). Used for testing before mainnet deployment.

**Block Explorer**  
A website for viewing on-chain transactions and contract state. NoctFinance testnet uses [horizen.calderaexplorer.xyz](https://horizen.calderaexplorer.xyz).

**RPC (Remote Procedure Call)**  
An API endpoint for interacting with a blockchain. NoctFinance dapp connects to Horizen RPC to send transactions.

**Gas**  
The fee paid for executing transactions on-chain. ZK verification is gas-intensive; zkVerify aggregation reduces per-proof costs.

**Faucet**  
A service that gives free testnet tokens. Used to get testnet ZEN, USDC, etc. for testing.

---

## Basis Points & Percentages

**Basis Point (bp)**  
One hundredth of one percent. 100 bps = 1%, 10,000 bps = 100%. Used for interest rates and fees.

**APY (Annual Percentage Yield)**  
The yearly interest rate including compounding. If you supply at 5% APY, you earn 5% per year.

**APR (Annual Percentage Rate)**  
The yearly interest rate without compounding. Less commonly used in DeFi than APY.

**Utilization Rate**  
The percentage of pool assets currently borrowed: `utilization = borrowed / (borrowed + available)`. Determines interest rates.

---

## Acronyms

- **ZK** — Zero-Knowledge
- **VK** — Verification Key
- **IMT** — Indexed Merkle Tree
- **LTV** — Loan-to-Value
- **UUPS** — Universal Upgradeable Proxy Standard
- **EVM** — Ethereum Virtual Machine
- **RPC** — Remote Procedure Call
- **API** — Application Programming Interface
- **ABI** — Application Binary Interface (contract interface format)
- **CLI** — Command-Line Interface
- **SDK** — Software Development Kit
- **TEE** — Trusted Execution Environment (like Vela)

---

## Further Reading

- [What is a Zero-Knowledge Proof?](https://ethereum.org/en/zero-knowledge-proofs/)
- [Noir Language Documentation](https://noir-lang.org/docs)
- [zkVerify Documentation](https://docs.zkverify.io/)
- [Horizen Documentation](https://docs.horizen.io/)
- [Understanding Merkle Trees](https://brilliant.org/wiki/merkle-tree/)

---

**Last updated:** 2026-08-19  
**Questions?** Join our Discord or open a GitHub discussion.
