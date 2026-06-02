# Subsystem 04 — Attestation Pipeline (Kurier → zkVerify → Horizen)

## 1. Purpose

The path a ZK proof takes from the prover (browser, Node SDK, or MCP
server) to a `verifyProofAggregation(...)=true` return on a Horizen
contract.

Much **simpler than v1's pipeline** because we use the documented Kurier
flow for UltraHonk — no TEE pallet, no novel patterns.

## 2. The flow (single mode — no epoch heartbeat needed)

Because every operation is its own ZK proof (no "TEE signs many actions"
shortcut), every user-facing action goes through this pipeline once. There
is no two-tier "routine vs high-value" distinction — all actions are
high-value-equivalent in trust.

```
prover (browser / Node / MCP)
   ↓ proof + public-inputs
Kurier REST API
   ↓ /submit-proof
zkVerify chain
   ↓ pallet-ultrahonk verifies
zkVerify aggregator
   ↓ adds to current aggregation batch (domain 175 testnet / 3 mainnet)
   ↓ once batch fills or interval elapses
NewAggregationReceipt emitted
   ↓ zkVerify relayer
ZkVerifyAggregationProxy on Horizen
   ↓ submitAggregation(domain, aggId, root)
Caller (often the same prover) polls /job-status
   ↓ Aggregated + aggregationDetails(receiptBlockHash, leaf, path, ...)
Caller submits the on-chain transaction
   ↓ pool.deposit/withdraw/borrow/etc.(payload, aggregationTuple)
LendingMarket → IVerifyProofAggregation.verifyProofAggregation
   ↓ returns true → state effects applied
```

**End-to-end latency: ~3-5 minutes typical, up to ~10 minutes worst case.**

## 3. Internal components

### Submitter (in our SDK; runs in browser or Node)

```ts
async function submitProof(proof: Uint8Array, publicInputs: Hex[],
                           kind: CircuitKind): Promise<JobId> {
  const body = {
    proofType: "ultrahonk",
    vkRegistered: true,
    chainId: NETWORK === "mainnet" ? 26514 : 2651420,
    proofOptions: {
      noir: "v1.0.0-beta.14+",
      bb: "v3.0",
      flavour: "ZK",                    // Keccak transcript
    },
    proofData: {
      proof: bytesToHex(proof),
      publicSignals: publicInputs,
      vk: VK_HASHES[kind],              // pre-registered hash
    },
  };
  const r = await fetch(
    `${KURIER_URL}/submit-proof/${KURIER_KEY}`,
    { method: "POST", body: JSON.stringify(body) }
  );
  const { jobId } = await r.json();
  await db.insertJob(jobId, kind, "Submitted");
  return jobId;
}
```

This shape **is documented** for UltraHonk in
`zkVerify-docs/docs/overview/02-getting-started/05-kurier.md`. No
inference, no spike needed.

### Poller

```ts
async function pollUntilAggregated(jobId: JobId): Promise<AggregationTuple> {
  for (;;) {
    const r = await fetch(`${KURIER_URL}/job-status/${KURIER_KEY}/${jobId}`);
    const job = await r.json();
    await db.updateStatus(jobId, job.status);

    if (job.status === "Aggregated") {
      // Persist receiptBlockHash IMMEDIATELY — published storage is one-block
      await db.persistAggregation(jobId, job.aggregationDetails);
      return job.aggregationDetails;
    }
    if (job.status === "Failed") {
      throw new Error(`Job ${jobId} failed`);
    }
    await sleep(15_000);                // 15s between polls
  }
}
```

### Aggregation tuple → on-chain call

```ts
async function consumeAggregation(
    contract: Contract,
    method: string,
    fixedArgs: any[],
    agg: AggregationTuple) {
  return contract[method](...fixedArgs,
                          agg.domainId, agg.aggregationId,
                          agg.merkleProof, agg.numberOfLeaves, agg.leafIndex);
}
```

### Fallback path

If Kurier returns 5xx or times out beyond 60 seconds: switch to direct
zkVerifyJS submission. Same proof, different transport. Requires an
account funded with tVFY (testnet) / VFY (mainnet) — we hold one in AWS
KMS for this purpose.

## 4. Data model

```sql
CREATE TABLE attestation_jobs (
    job_id            uuid PRIMARY KEY,
    submitted_by      text NOT NULL,         -- 'browser' / 'node-sdk' / 'mcp-server' / 'keeper'
    circuit_kind      text NOT NULL,         -- 'deposit_supply', 'borrow', etc.
    submitted_at      timestamptz NOT NULL,
    status            text NOT NULL,         -- Queued / Valid / Submitted / IncludedInBlock /
                                             -- Finalized / AggregationPending / Aggregated /
                                             -- AggregationPublished / Failed
    chain_id          int NOT NULL,
    -- after Aggregated:
    receipt_block_hash bytea,
    domain_id         int,
    aggregation_id    bigint,
    leaf              bytea,
    leaf_index        int,
    number_of_leaves  int,
    merkle_path       bytea[],
    finalized_at      timestamptz,
    -- accounting:
    kurier_cost_vfy   numeric,
    user_op_hash      bytea                  -- for ERC-4337 userOps
);
```

The Postgres lives in our backend (Subsystem 06's region). Browsers don't
have one — they poll directly and persist results to the SDK's localStorage
session.

## 5. Security & privacy

- **Replay protection** at the protocol level (nullifier set per pool).
  Even if a proof is replayed somehow, the second tx fails on
  nullifier-spent.
- **Public-input commitment** — the proof binds to specific public inputs;
  changing the recipient or amount post-hoc invalidates the proof.
- **Block-hash retention is critical** (same as v1). Poller persists
  `receipt_block_hash` immediately.
- **Submitter-account funding** for the zkVerifyJS fallback is in AWS KMS;
  rotated quarterly.
- **No private data crosses Kurier.** The proof reveals only what the
  circuit's public inputs declare.

## 6. Agent accessibility notes

Both human and agent flows go through the **same submitter + poller code**
(it lives in the shared SDK). Agents typically run server-side, so their
prover speed is better (no browser WASM overhead).

Idempotency: the SDK key for a job is computed as
`hash(circuit_kind, public_inputs, owner)`. Resubmitting the same intent
results in the same key → same DB row → idempotent.

## 7. Dependencies

- Kurier API key (server-side env only; never in browser).
- `@aztec/bb.js` for prover.
- `zkverifyjs` for fallback path.
- PostgreSQL for job tracking.
- Funded VFY/tVFY account for fallback.

## 8. Diagram

```mermaid
sequenceDiagram
    participant CLIENT as Browser / Node SDK / MCP server
    participant DB as Postgres (backend jobs)
    participant KUR as Kurier API
    participant ZKV as zkVerify chain<br/>(pallet-ultrahonk)
    participant REL as zkVerify Relayer
    participant ZKP as zkVerify Proxy on Horizen
    participant LM as Lending contract (pool / board)

    CLIENT->>CLIENT: generate ZK proof (~5s)
    CLIENT->>DB: INSERT attestation_jobs
    CLIENT->>KUR: POST /submit-proof (UltraHonk + chainId)
    KUR-->>CLIENT: { jobId }

    loop until Aggregated
        CLIENT->>KUR: GET /job-status/{jobId}
        KUR-->>CLIENT: { status, [aggregationDetails] }
        Note over CLIENT: ~15s between polls
    end

    Note over ZKV,REL: aggregator emits NewAggregationReceipt;<br/>relayer picks up
    REL->>ZKP: submitAggregation(domain, aggId, root)

    KUR-->>CLIENT: status='Aggregated' +<br/>aggregationDetails
    CLIENT->>DB: persist receiptBlockHash + path

    CLIENT->>LM: deposit/withdraw/borrow(payload, aggTuple)
    LM->>ZKP: verifyProofAggregation
    ZKP-->>LM: true
    LM-->>CLIENT: tx success
    CLIENT->>DB: UPDATE finalized_at
```
