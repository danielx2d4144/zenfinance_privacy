# ADR-002: Note Recovery via Random Salt + Encrypted Memo (supersedes counter-derived salts)

Date: 2026-07-30 | Status: ACCEPTED (decided in /plan-eng-review D4=A2a; implementation in M2)
Supersedes: design-v2/subsystems/09_note_management.md salt/recovery spec AND the
interim counter-salt design (office-hours/CEO-review D8), both retired before implementation.

## Context

Two prior recovery designs were rejected:

1. **S09 original:** `salt = H(spending_key, pool_address, leaf_index)` — circular:
   the leaf index isn't known until after insertion, but the commitment (which
   includes the salt) must be submitted with the tx. Unimplementable as written.
2. **Counter-salt interim (D8):** `salt = H(spendingKey, "note-salt", counter)` —
   cross-model crypto review found two fund-loss modes: (a) two devices with the
   same wallet both derive counter N → identical nullifiers → second note
   permanently unspendable; (b) failed txs burn counters toward the recovery gap
   limit, silently orphaning later notes.

## Decision

Standard shielded-pool pattern (Zcash/Aztec/Railgun):

- **Per-note random salt** (CSPRNG, never derived).
- Deposit carries an **encrypted memo**: the note's secrets encrypted (ECIES-style)
  to a **viewingKey** derived from the wallet signature. Memo emitted in the
  `Deposited` event via an ADDITIVE contract overload:
  `deposit(token, amount, commitment, bytes calldata encryptedMemo)`.
- **Recovery** on any device: derive viewingKey from the wallet signature, fetch
  all deposit events (full-set sync, chunked eth_getLogs), trial-decrypt each memo;
  successes are your notes. Nullifier spent-status checked against the locally
  synced nullifier set — never per-note RPC queries (light-client privacy leak).

Key derivation (all from one EIP-712 ceremony signature, domain =
{name:"ZenFinance", chainId, verifyingContract:PrivacyEntry}):
HKDF over canonicalized low-s `r||s` (v dropped — wallet v-encoding varies);
separate HKDF info tags → `spendingKey` / `viewingKey` / `storageKey`.

## Circuit impact: NONE (verified 2026-07-30)

All 11 circuits take salts as private witness inputs constrained only by
`assert(salt != 0)`; no circuit constrains salt derivation. No vkHash re-pins.
(Stale comment noted: entry_withdraw/src/main.nr:14 still says "pedersen_hash";
hash is Poseidon2 since Day 14c.)

## Consequences

- Multi-device is safe by design; no counters, no gap limit, no WAL-reserved indices.
- Contract change is additive (new overload + event field); existing 217 forge
  tests untouched; new forge tests for the overload; testnet redeploy required.
- EOA-deterministic-signature constraint remains for key RE-derivation
  (sign-twice check + warning for smart wallets, per D19=12A).
