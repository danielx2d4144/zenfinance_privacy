# Changelog

All notable changes to NoctFinance will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Comprehensive documentation suite (README, GLOSSARY, DEPLOYMENTS, ARCHITECTURE)
- Documentation strategy based on Horizen ecosystem best practices (Zendex, Layrs)
- VK derivation script (`code/dapp/scripts/derive-vks.mjs`) for canonical VK generation
- Keccak VK format support (1888 bytes) for zkVerify compatibility
- Investigation documentation for VK format issue (`BB_JS_DOWNGRADE_FINDINGS.md`, `VK_FIX_COMPLETE.md`)
- Horizen team guidance documentation (`Fixing the VK Registration Issue.md`)
- Vela TEE proving integration specification (`docs/VELA_PROVING_INTEGRATION.md`)

### Changed
- **[BREAKING]** Switched from Poseidon2 to Keccak oracle hash format for VK generation
  - VKs changed from 3680 bytes (Poseidon2) to 1888 bytes (Keccak)
  - Browser prover now uses `generateProof(witness, { keccakZK: true })`
  - All 11 circuits re-derived and re-registered with Kurier
  - VkRegistry.sol documentation updated to reflect Keccak format
- Updated `kurier-vk-hashes.ts` with new Kurier VK hashes from Keccak format registration

### Fixed
- Recovery scan performance in `useSpendingKey.tsx`
  - Added incremental scan with localStorage cursor caching
  - Reduced page load time from 8-14s to ~1-2s on subsequent unlocks
  - Throttled progress callbacks to max 1 update per 600ms
- VK format mismatch between bb.js 3.0.x and Kurier
  - Root cause: bb.js defaults to Poseidon2 (recursion format), zkVerify needs Keccak (EVM format)
  - Resolution: Added `keccakZK: true` option to proof generation

---

## [0.1.0] - 2026-08-03

### Added
- Initial testnet deployment on Horizen (chain ID 2651420)
- 11 Noir ZK circuits covering full lending lifecycle
  - Entry: `entry_deposit`, `entry_withdraw`
  - Supply: `supply_asset`, `withdraw_supply`
  - Collateral: `deposit_collateral`, `withdraw_collateral`
  - Borrowing: `borrow`, `repay`, `liquidate`
  - Maintenance: `consolidate_balance`, `compute_triggers`
- Smart contract architecture
  - ZkVerifier with zkVerify integration
  - Privacy layer (PrivacyEntry, commitment/nullifier registries)
  - Lending pools (ShieldedSupplyPool, ShieldedPositionPool)
  - Liquidation engine and insurance fund
- Frontend dapp (Next.js 15 with App Router)
  - Browser-based UltraHonk proof generation via bb.js 3.0.0-rc.6
  - Web Worker for non-blocking proof generation
  - Encrypted note storage with recovery from spending key
- Backend services
  - data-api (Fastify) for proof submission to Kurier
  - prover-service for VK registration
- zkVerify integration
  - Kurier REST API submission
  - UltraHonk proof verification
  - Aggregation and on-chain attestation

### Security
- Commitment-based privacy model (Poseidon2 hash)
- Nullifier-based double-spend prevention
- Merkle tree for efficient commitment storage
- ZK proofs for all balance-revealing operations
- Recovery mechanism from spending key alone

---

## Release Notes

### Keccak VK Format Update (2026-08-19)

This update resolves the VK format incompatibility between bb.js 3.0.x and zkVerify's Kurier service.

**What changed:**
- VK generation now uses Keccak oracle hash instead of Poseidon2
- VK size reduced from 3680 bytes to 1888 bytes
- All proofs now include `keccakZK: true` option

**Why:**
zkVerify's UltraHonk V3_0 pallet expects Keccak-format VKs (designed for on-chain EVM verification). The default bb.js format (Poseidon2) is designed for recursion and produces 3680-byte VKs that Kurier rejects.

**Impact:**
- ✅ All 11 VKs re-derived using Keccak format
- ✅ All VKs re-registered with Kurier (accepted)
- ⚠️ VkRegistry.sol VK hashes changed (contracts need redeployment)
- ⚠️ Proof submission now works with zkVerify

**Action required:**
1. Redeploy ZkVerifier with updated VkRegistry
2. Update frontend/backend contract addresses
3. Test live proof submission

**Credit:**
Thanks to Horizen DevRel team (Michael "Clive") for diagnosing the issue and providing the fix.

---

## Upcoming

### Phase 2 Completion
- [ ] Redeploy ZkVerifier with Keccak VK hashes
- [ ] Test live proof submission (supply → Kurier → zkVerify → Horizen)
- [ ] Verify `ProofConsumed` event emission
- [ ] Complete end-to-end zkVerify integration

### Phase 3: Hosting
- [ ] Deploy data-api to Railway
- [ ] Deploy dapp to Vercel
- [ ] Set up invite gate for closed beta
- [ ] Configure custom domain

### Phase 4: UX Redesign
- [ ] Rebuild position screen with health factor visualization
- [ ] Add guided borrow flow
- [ ] Improve mobile responsiveness
- [ ] Add transaction history view

### Phase 5: QA & Evidence Pack
- [ ] Comprehensive testing across all operations
- [ ] Performance benchmarking
- [ ] Evidence pack for audit/review
- [ ] Public testnet launch

### Future
- [ ] Vela TEE proving integration (server-side proving)
- [ ] Mainnet deployment
- [ ] External security audit
- [ ] Governance system

---

## Breaking Changes

### 0.1.0 → Unreleased (Keccak VK Update)

**Contract Changes:**
- VkRegistry.sol VK hash constants changed
- ZkVerifier must be redeployed

**Frontend Changes:**
- Proof generation now requires `keccakZK: true` option
- Contract addresses will change after redeployment

**Backend Changes:**
- Kurier VK hashes updated in `kurier-vk-hashes.ts`
- VK registration uses new Keccak format

**Migration:**
```bash
# Re-derive VKs
cd code/dapp
node scripts/derive-vks.mjs

# Re-register with Kurier
cd ../backend/prover-service
npm run register-vks

# Redeploy contracts
cd ../../contracts
forge script script/deploy/horizen/ZkVerifier.s.sol:DeployZkVerifier \
  --rpc-url horizen --broadcast
```

---

## Version History

- **Unreleased** — Keccak VK format, documentation, recovery scan optimization
- **0.1.0** (2026-08-03) — Initial testnet deployment

---

For detailed commit history, see [GitHub commits](https://github.com/noctfinance/noctfinance/commits/main).
