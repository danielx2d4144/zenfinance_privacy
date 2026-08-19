# Vela TEE Proving Integration
## Implementation Reference — NoctFinance

**Purpose:** This document is the implementation reference for replacing in-browser proof generation with TEE-delegated proving via Horizen's Vela infrastructure. Read this before writing any code for this feature.

---

## 1. Problem Statement

### What is slow today

```
User clicks action (e.g. "Borrow")
  → [100ms]   Witness construction    (browser, trivial)
  → [2–30s]   Proof generation        (browser, bb.js WebAssembly, hardware-bound)
  → [network] POST to data-api        (milliseconds)
  → [2–5s]    Kurier submission       (network)
  → [5–60s]   zkVerify aggregation    (waiting for batch)
  → [1–2s]    On-chain confirmation   (Horizen ~1s blocks)
```

The browser proof generation step is the bottleneck. It blocks the UI thread (even in a Web Worker, the tab must stay alive), is hardware-dependent (30s on a 2020 laptop vs 2s on a M3 Mac), and fails entirely on mobile due to memory limits (bb.js WASM needs 400–800MB).

### What we want

```
User clicks action
  → [100ms]   Witness construction    (browser, trivial, unchanged)
  → [50ms]    Witness encryption      (browser, ECIES to TEE pubkey)
  → [network] POST encrypted bundle to data-api
  → UI immediately shows "queued" — user can close the tab
  ↓ (background, Vela)
  → [~2s]     Proof generation        (TEE enclave, server hardware)
  → [network] Kurier submission
  → [5–60s]   zkVerify aggregation
  → [1–2s]    On-chain confirmation
  → User gets balance update on next open or push notification
```

---

## 2. Architecture Overview

### Key insight

Witness construction requires the spending key (private, on device). Proof generation only requires the witness (the private inputs + circuit). Once the witness is built, any party with the witness can generate the same proof. There is no cryptographic reason proof generation must happen on the user's device.

### The split

```
Browser                          Vela TEE Enclave
──────────────────────           ─────────────────────────────────
Key derivation (EIP-712)         Attest pubkey on-chain
Build witness (100ms)            Receive encrypted witness bundle
Encrypt witness →                Decrypt inside enclave (hardware-isolated)
  ECIES(tee_pubkey, witness)     Generate proof (bb.js or native barretenberg)
POST encrypted bundle            Submit proof → Kurier → zkVerify
Show "queued"                    Mark intent confirmed
```

### Why privacy is maintained

The Vela TEE is operator-blind. Even NoctFinance team members cannot read what runs inside the enclave. The only thing that exits the enclave is the ZK proof (which by definition reveals nothing about the witness) and the signed transaction. The witness plaintext never leaves the hardware boundary.

---

## 3. Current Code Map

Understanding the existing flow is required before changing it.

### Browser side (dapp)

| File | Role |
|---|---|
| `code/dapp/src/hooks/useSpendingKey.tsx` | Key derivation, session unlock, recovery scan |
| `code/dapp/src/lib/key-derivation.ts` | EIP-712 → spending/viewing/storage keys |
| `code/dapp/src/lib/witness.ts` | Witness construction per circuit |
| `code/dapp/src/lib/note-vault.ts` | Encrypted note persistence |
| `code/dapp/src/lib/recovery-adapter.ts` | Log scanning, chunked getLogs |

The Web Worker that currently runs bb.js lives alongside the dapp. Its entry point needs to be located before Phase 2 work begins — search for `bb.js` or `UltraHonk` worker instantiation.

### Data-api side (backend)

| File | Role |
|---|---|
| `code/backend/data-api/src/intent/schemas.ts` | Intent types — `ProofBundle` is `{ proof: Hex, publicInputs: string[] }` |
| `code/backend/data-api/src/intent/state.ts` | Intent lifecycle: `received → proving → submitted → aggregated → userop_pending → confirmed → failed` |
| `code/backend/data-api/src/intent/handlers/verify-and-call.ts` | Shared handler that calls Kurier + on-chain pool method |
| `code/backend/data-api/src/intent/handlers/entry-deposit.ts` | Entry deposit (no proof, relayer-only) |
| `code/backend/data-api/src/intent/kurier-poll.ts` | Kurier submission + polling |
| `code/backend/data-api/src/intent/resume.ts` | Boot-sweep: resumes stalled intents after restart |

### Critical: current ProofBundle contract

Every non-deposit intent schema carries a `proofBundle`:

```ts
// code/backend/data-api/src/intent/schemas.ts:27
const ProofBundle = z.object({
  proof: HexBlob,
  publicInputs: z.array(z.string()),
});
```

Today the browser generates the proof and puts it in this field before POSTing. After this integration, the browser sends an encrypted witness instead. The data-api receives it, queues it, and the Vela service generates the proof and fills in the equivalent data server-side. The `ProofBundle` shape does not change on the contract side — only who produces it changes.

---

## 4. New Component: Vela Prover Service

This is a new backend service, separate from `data-api` and `prover-service`.

### Location

```
code/backend/vela-prover/
  src/
    index.ts          — entry point, polls intent queue
    enclave/
      keypair.ts      — TEE key generation + on-chain attestation
      decrypt.ts      — ECIES decryption of witness bundle
    proving/
      runner.ts       — runs bb.js (WASM) or native barretenberg inside enclave
      circuits.ts     — maps circuit name → compiled artifact path
    queue/
      poll.ts         — polls data-api for intents with status=tee_queued
      complete.ts     — posts completed ProofBundle back to data-api
  Dockerfile
  .env.example
```

### Runtime options (to be decided based on Vela memory benchmark)

**Option A: bb.js WASM inside Vela**
- Same `bb.js` binary already used in the browser
- Requires ~400–800MB enclave memory
- No new build artifacts needed
- Risk: Vela enclave memory limit may not support this

**Option B: Native Barretenberg inside Vela**
- Build `barretenberg` C++ → Rust FFI or Go CGO inside Vela
- Lower memory footprint
- More build complexity
- Fallback if Option A fails memory validation

**The first engineering task is to test Option A.** Spin up a Vela sandbox, load the bb.js WASM build for one circuit (smallest circuit first), run one proof, measure memory peak. If it crashes or exceeds limits, pivot to Option B.

---

## 5. New Intent Flow: `tee_queued` Status

### New intent status needed

Add `tee_queued` to the intent lifecycle in `state.ts`:

```
received → tee_queued → proving → submitted → aggregated → userop_pending → confirmed
                                                                           → failed
```

`tee_queued` means: the encrypted witness bundle has been received and stored; the Vela prover has not yet picked it up.

### New intent schema change

For the TEE path, the browser does NOT send a `proofBundle`. It sends an `encryptedWitnessBundle` instead:

```ts
// New field on ProofBundle-carrying intents (TEE mode)
const EncryptedWitnessBundle = z.object({
  teeEphemeralPubkey: z.string(),   // hex, ephemeral ECDH key from browser
  ciphertext: HexBlob,              // AES-GCM encrypted witness JSON
  iv: HexBlob,                      // 12-byte IV
  circuitId: z.number().int(),      // which of the 11 circuits to prove
});
```

The existing `ProofBundle` field stays in the schema — it becomes optional when `encryptedWitnessBundle` is present. This keeps backward compatibility with the current browser prover path during the transition period.

```ts
// Updated in schemas.ts
const ProofBundle = z.object({
  proof: HexBlob,
  publicInputs: z.array(z.string()),
}).optional();

// Intents can carry either a proofBundle (browser-proved) OR
// an encryptedWitnessBundle (TEE-proved), not both.
```

---

## 6. Browser Changes

### What changes

| Today | After |
|---|---|
| Build witness | Build witness (unchanged) |
| Run bb.js in Web Worker (slow) | Encrypt witness with TEE pubkey (fast) |
| POST intent with proofBundle | POST intent with encryptedWitnessBundle |
| Block UI until proof done | Show "queued" immediately, non-blocking |

### ECIES encryption in browser

```ts
// New file: code/dapp/src/lib/tee-encrypt.ts

/**
 * Encrypt a witness bundle for the Vela TEE.
 *
 * Uses ECIES (ECDH key agreement + AES-GCM):
 *   1. Generate ephemeral EC key pair in browser
 *   2. ECDH with TEE's attested public key → shared secret
 *   3. HKDF(shared secret) → AES-GCM key
 *   4. AES-GCM encrypt(witness JSON)
 *   5. Output: { ephemeralPubkey, ciphertext, iv }
 *
 * The TEE holds the private key inside the enclave; only it can
 * decrypt. The TEE pubkey is fetched from the attestation endpoint
 * and verified against the on-chain attestation before use.
 */
export async function encryptWitnessForTEE(
  witness: WitnessBundle,
  teePubkeyHex: string,
): Promise<EncryptedWitnessBundle>
```

### TEE pubkey verification

Before encrypting, the browser must verify the TEE pubkey is genuine:

1. Fetch TEE pubkey from data-api (`GET /tee/pubkey`)
2. data-api returns `{ pubkey: hex, attestationTxHash: hex }`
3. Browser checks: `attestationTxHash` exists on-chain and the pubkey in the event matches
4. Only then encrypt

This prevents a compromised data-api from substituting its own key.

### Non-blocking UX changes

The action flow in the dapp changes from:

```
click → start Web Worker → await proof (blocking) → POST → await confirmation → update UI
```

to:

```
click → build witness (100ms) → encrypt (50ms) → POST → show "queued" toast → poll status
```

Status polling: `GET /intents/:id` every 3 seconds. When status reaches `confirmed`, update balance and show success. This is a frontend-only change layered on the existing intent state endpoint.

---

## 7. Data-API Changes

### New endpoint: `GET /tee/pubkey`

Returns the current TEE attested public key.

```ts
// code/backend/data-api/src/routes/tee.ts
router.get('/tee/pubkey', async (req, reply) => {
  return {
    pubkey: config.TEE_PUBKEY_HEX,
    attestationTxHash: config.TEE_ATTESTATION_TX_HASH,
    chain: config.CHAIN_ID,
  }
})
```

### Intent handler changes

Intents arriving with `encryptedWitnessBundle` instead of `proofBundle`:

1. Store the encrypted bundle in a new `encrypted_witness` column on the `intents` table
2. Set status to `tee_queued` (not `proving`)
3. Return `202 Accepted` immediately — do not wait for proof

The Vela prover service polls for `tee_queued` intents, generates proofs, and calls a new internal endpoint to deliver the completed `ProofBundle`. The existing `verifyAndCall` handler then runs unchanged from the `ProofBundle` onward.

### New internal endpoint: `POST /internal/intents/:id/proof`

Called by the Vela prover service after proof generation:

```ts
// Called by Vela prover, not the browser
router.post('/internal/intents/:id/proof', async (req, reply) => {
  const { proof, publicInputs } = ProofBundle.parse(req.body)
  // Update intent row with the generated proof
  // Set status from tee_queued → proving
  // Trigger the existing verifyAndCall pipeline
})
```

This endpoint must be authenticated (shared secret between data-api and Vela service, never exposed to browser).

### Migration

New column on `intents` table:

```sql
ALTER TABLE intents
  ADD COLUMN encrypted_witness BYTEA,
  ADD COLUMN tee_proving_started_at TIMESTAMPTZ;

-- Add tee_queued to the status enum
ALTER TYPE intent_status ADD VALUE 'tee_queued' AFTER 'received';
```

---

## 8. Vela Prover Service — Core Loop

```ts
// code/backend/vela-prover/src/queue/poll.ts

/**
 * Main loop running inside the Vela enclave.
 *
 * 1. Poll data-api for intents with status=tee_queued
 * 2. For each: decrypt witness bundle using enclave private key
 * 3. Load the correct circuit artifact
 * 4. Run bb.js (or native barretenberg) to generate proof
 * 5. POST ProofBundle to data-api internal endpoint
 * 6. Handle failure: update intent to failed with reason
 */
async function runProverLoop() {
  while (true) {
    const intents = await fetchTeeQueuedIntents()
    for (const intent of intents) {
      try {
        const witness = await decryptWitness(intent.encrypted_witness)
        const circuit = circuits[witness.circuitId]
        const { proof, publicInputs } = await generateProof(circuit, witness)
        await deliverProof(intent.id, { proof, publicInputs })
      } catch (err) {
        await markIntentFailed(intent.id, err.message)
      }
    }
    await sleep(1000)
  }
}
```

---

## 9. Backward Compatibility During Rollout

The browser prover is NOT removed immediately. Both paths run in parallel:

- If `NEXT_PUBLIC_TEE_PROVING=true` → browser sends `encryptedWitnessBundle`
- If `NEXT_PUBLIC_TEE_PROVING=false` (default) → browser sends `proofBundle` (current behavior)

This lets the TEE path be validated on testnet without breaking the current working flow. The browser prover becomes a fallback that stays available for users who prefer self-sovereign proving or in case Vela is unreachable.

---

## 10. Implementation Phases

### Phase 0: Vela memory benchmark (1–2 days)
- Set up Vela sandbox
- Load bb.js WASM + smallest circuit artifact
- Run one proof inside the enclave
- Measure peak memory and wall-clock time
- Decision point: Option A (WASM) or Option B (native barretenberg)
- **Do not proceed to Phase 1 until this is answered**

### Phase 1: Vela keypair + attestation (2–3 days)
- Generate EC keypair inside Vela enclave
- Post attestation transaction to Horizen testnet
- Implement `GET /tee/pubkey` in data-api
- Write browser ECIES encrypt function (`tee-encrypt.ts`)
- Write Vela ECIES decrypt function
- Test: browser encrypts a test string, Vela decrypts it correctly

### Phase 2: Intent schema + DB migration (1 day)
- Add `tee_queued` to intent status enum
- Add `encrypted_witness` column
- Update intent schemas in `schemas.ts` to accept `encryptedWitnessBundle`
- Update intent handler to set `tee_queued` when witness bundle received
- Add `POST /internal/intents/:id/proof` endpoint

### Phase 3: Vela prover service (3–4 days)
- Implement prover loop
- Wire circuit registry (maps circuitId → artifact path)
- Test end-to-end: browser → data-api → Vela proves → data-api confirms → Kurier → on-chain

### Phase 4: Async UX in dapp (1–2 days)
- Remove blocking wait for Web Worker proof generation
- Show "queued" toast on POST 202
- Add status polling (`GET /intents/:id` every 3s)
- Show confirmation when `confirmed`
- Detect device capability: TEE path on mobile/weak devices, browser path on powerful desktop

### Phase 5: Hardening (ongoing)
- TEE pubkey rotation scheme
- Vela restart recovery (resume `tee_queued` intents on boot)
- Circuit artifact integrity check inside enclave
- Monitoring: alert if Vela queue depth > N for > T seconds

---

## 11. Open Questions (must be resolved before implementation)

| Question | Who resolves | Impact |
|---|---|---|
| What is Vela's enclave memory limit? | Horizen dev / Vela docs | Determines Option A vs B |
| Is Vela enclave kept warm between requests or cold-started? | Horizen dev | Determines latency target |
| Does Vela expose an HTTPS endpoint or a different transport? | Vela docs | Affects Phase 1 design |
| Is the internal `POST /internal/intents/:id/proof` endpoint called over loopback or authenticated HTTPS? | Architecture decision | Affects security design |
| Can we run multiple parallel proofs inside one enclave instance? | Vela docs | Affects throughput design |

---

## 12. Files to Create / Modify Summary

### New files
```
code/backend/vela-prover/                        — entire new service
code/dapp/src/lib/tee-encrypt.ts                 — ECIES witness encryption
code/backend/data-api/src/routes/tee.ts          — GET /tee/pubkey
code/backend/data-api/src/migrations/XXX_tee.sql — encrypted_witness column + tee_queued status
```

### Modified files
```
code/backend/data-api/src/intent/schemas.ts      — add encryptedWitnessBundle, make proofBundle optional
code/backend/data-api/src/intent/state.ts        — add tee_queued to INTENT_STATUSES and RESUMABLE_STATUSES
code/backend/data-api/src/intent/resume.ts       — resume tee_queued intents on boot
code/backend/data-api/src/routes/intents.ts      — route to tee_queued handler when bundle present
code/backend/data-api/src/config.ts              — add TEE_PUBKEY_HEX, TEE_ATTESTATION_TX_HASH
code/dapp/src/lib/                               — action hooks: swap Web Worker call for tee-encrypt call
```

### Unchanged (no modifications needed)
```
code/backend/data-api/src/intent/handlers/verify-and-call.ts   — unchanged, runs from ProofBundle onward
code/backend/data-api/src/intent/kurier-poll.ts                 — unchanged
code/contracts/                                                  — no contract changes needed
```
