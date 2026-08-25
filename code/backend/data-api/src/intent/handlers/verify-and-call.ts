import type { Pool } from "pg";
import type { Abi, Address, Hex } from "viem";

import { getChainClients } from "../../chain/clients.js";
import { setMockProxyAllowed } from "../../chain/mock-proxy.js";
import type { AggregationProofTuple } from "../../chain/zk-verifier.js";
import {
  AGGREGATION_PROXY_ABI,
  ZK_VERIFIER_ABI,
} from "../../chain/zk-verifier.js";
import { withChainLock } from "../../chain/mutex.js";
import { getConfig } from "../../config.js";
import {
  getKurierJobId,
  insertJobWithTx,
  recordKurierJobId,
  updateIntentStatus,
  type IntentRow,
} from "../state.js";
import {
  resumeAggregation,
  submitAndWait,
  type AggregationReceipt,
} from "../kurier-poll.js";
import type { CircuitName } from "../vk-registry.js";

const ZERO_ROOT: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * How long to wait for the aggregation root to appear on the destination-chain
 * proxy before giving up and attempting the tx anyway. Kurier's own poll
 * timeout is 20 minutes (`KURIER_POLL_TIMEOUT_MS`); the publish lag after
 * `Aggregated` is a much shorter tail, so 3 minutes is generous.
 */
const PROXY_WAIT_TIMEOUT_MS = 180_000;
const PROXY_POLL_INTERVAL_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const POOL_ROOT_READ_ABI = [
  {
    type: "function",
    name: "currentRoot",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
] as const;

/**
 * Substitute a zero `rootAtProveTime` placeholder with the pool's
 * live `currentRoot()`. Pool methods that take a `rootAtProveTime`
 * argument check `_knownRoot[rootAtProveTime]` — using the current
 * root guarantees that check passes.
 *
 * TODO(day-14c): once Pedersen lands contract-side, the dapp will
 * compute the same root the contract sees and this helper goes away.
 */
async function resolveRootArg(
  rawArg: unknown,
  pool: Address,
  publicClient: ReturnType<typeof getChainClients>["publicClient"],
): Promise<Hex> {
  if (rawArg !== ZERO_ROOT) return rawArg as Hex;
  return (await publicClient.readContract({
    address: pool,
    abi: POOL_ROOT_READ_ABI,
    functionName: "currentRoot",
  })) as Hex;
}

/**
 * Shared verify+call helper for the 8 real handlers (entry_withdraw,
 * supply, withdraw_supply, deposit_collateral, withdraw_collateral,
 * borrow, repay, liquidate). consolidate_balance has no contract
 * surface and uses a different path.
 *
 * Flow per handler:
 *   1. updateIntentStatus(proving) — proof is in hand from the dapp
 *   2. submit to Kurier (or the mock receipt on Anvil), persisting the job id
 *      before the wait so a restart can re-attach; wait for aggregation
 *   3. updateIntentStatus(aggregated) — receipt available
 *   4. withChainLock(async () => {
 *        setAllowed on the mock proxy   [mock mode only]
 *        the caller-provided pool method (e.g., supplyAsset), which runs
 *        verifyAndConsume on ZkVerifier internally
 *      })
 *   5. updateIntentStatus(confirmed) + insertJobWithTx
 *
 * On any throw → status=failed with the error message (truncated to 500
 * chars to fit the failure_reason column).
 */

export interface VerifyAndCallArgs {
  pool: Pool;
  intent: IntentRow;
  circuit: CircuitName;
  proof: Hex;
  publicInputs: string[];
  /** The pool contract to call after verifyAndConsume. */
  target: Address;
  targetAbi: Abi;
  targetFunction: string;
  /** Arguments for the pool method; receipt is appended automatically as
   *  the last argument (the AggregationProof tuple expected by every
   *  pool method that takes a proof). */
  targetArgs: readonly unknown[];
  /** Index into targetArgs where a bytes32 `rootAtProveTime` lives. If
   *  set, and the value at that index is the all-zero placeholder, the
   *  helper substitutes the pool's live `currentRoot()` so the contract's
   *  `_knownRoot` check passes. */
  rootArgIndex?: number;
}

export async function verifyAndCall(args: VerifyAndCallArgs): Promise<void> {
  const { pool, intent } = args;

  try {
    await updateIntentStatus(pool, intent.id, "proving");

    const receipt = await attest(pool, intent, args);

    await updateIntentStatus(pool, intent.id, "aggregated");

    const { account, publicClient, walletClient, mockProxy, domainId, zkVerifier } =
      getChainClients();

    const aggregationProof = receiptToTuple(receipt, domainId);

    // Wait for the aggregation root to land on the destination-chain proxy.
    // Deliberately outside withChainLock: this can block for minutes and
    // holding the chain mutex would serialise every other intent behind it.
    if (getConfig().ATTESTATION_MODE === "kurier") {
      await waitForAggregationOnChain(aggregationProof, publicClient, zkVerifier);
    }

    let depositHash: Hex;
    await withChainLock(async () => {
      // Step 1 (mock mode only): open the synthetic aggregation slot on the
      // mock proxy so when the pool's internal verifyAndConsume calls
      // verifyProofAggregation, the proxy returns true.
      //
      // The pool contracts already invoke ZkVerifier.verifyAndConsume
      // themselves (e.g., ShieldedSupplyPool.supplyAsset:99). Calling
      // it ourselves would consume the replay slot first and make the
      // pool's internal call revert with AlreadyConsumed.
      //
      // Against the real zkVerify proxy there is nothing to open: the
      // aggregation root is already published on-chain and the merkle witness
      // in the receipt is what proves membership. This is the seam where the
      // cryptography stops being theatre.
      if (getConfig().ATTESTATION_MODE === "mock") {
        if (!mockProxy) throw new Error("ATTESTATION_MODE=mock but MOCK_PROXY_ADDRESS is unset");
        await setMockProxyAllowed({
          proxyAddress: mockProxy,
          domainId: aggregationProof.domainId,
          aggregationId: aggregationProof.aggregationId,
          leafIndex: aggregationProof.leafIndex,
        });
      }

      // Step 2: pool method. The pool runs its own verifyAndConsume
      // against ZkVerifier as part of the externals.
      await updateIntentStatus(pool, intent.id, "userop_pending");
      const finalArgs = await maybeFillRoot(
        args.targetArgs,
        args.rootArgIndex,
        args.target,
        publicClient,
      );
      depositHash = await walletClient.writeContract({
        address: args.target,
        abi: args.targetAbi,
        functionName: args.targetFunction,
        args: [...finalArgs, aggregationProof],
        account,
      });
      const txReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
      if (txReceipt.status !== "success") {
        throw new Error(`${args.targetFunction} reverted (tx ${depositHash})`);
      }

      await insertJobWithTx(pool, intent.id, Buffer.from(depositHash.slice(2), "hex"), {
        txHash: depositHash,
        blockNumber: txReceipt.blockNumber.toString(),
        gasUsed: txReceipt.gasUsed.toString(),
      });
    });

    await updateIntentStatus(pool, intent.id, "confirmed");
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await updateIntentStatus(pool, intent.id, "failed", reason.slice(0, 500));
  }
}

/**
 * Get an aggregation receipt for this intent, re-attaching rather than
 * re-submitting when a previous process already handed the proof to Kurier.
 *
 * Re-submitting after a restart would be worse than wasteful: the first
 * submission is still aggregating, and its leaf — once published — consumes
 * the ZkVerifier replay slot for this proof. The second receipt would then
 * revert with `AlreadyConsumed` and the user would see a failure for an action
 * that actually succeeded.
 */
async function attest(
  pool: Pool,
  intent: IntentRow,
  args: VerifyAndCallArgs,
): Promise<AggregationReceipt> {
  const existing = await getKurierJobId(pool, intent.id);
  if (existing && getConfig().ATTESTATION_MODE === "kurier") {
    return resumeAggregation(args.circuit, existing);
  }

  return submitAndWait({
    circuit: args.circuit,
    proof: args.proof,
    publicInputs: args.publicInputs,
    onSubmitted: async (jobId) => {
      await recordKurierJobId(pool, intent.id, jobId);
      await updateIntentStatus(pool, intent.id, "submitted");
    },
  });
}

function receiptToTuple(
  receipt: AggregationReceipt,
  domainId: bigint,
): AggregationProofTuple {
  return {
    domainId,
    aggregationId: BigInt(receipt.aggregationId),
    leaf: receipt.details.leaf,
    merklePath: receipt.details.merkleProof,
    leafCount: BigInt(receipt.details.numberOfLeaves),
    leafIndex: BigInt(receipt.details.leafIndex),
  };
}

async function maybeFillRoot(
  args: readonly unknown[],
  idx: number | undefined,
  target: Address,
  publicClient: ReturnType<typeof getChainClients>["publicClient"],
): Promise<readonly unknown[]> {
  if (idx === undefined) return args;
  const live = await resolveRootArg(args[idx], target, publicClient);
  if (live === args[idx]) return args;
  return args.map((v, i) => (i === idx ? live : v));
}

/**
 * Attempts to observe the aggregation root on the destination-chain proxy
 * before spending gas on the pool call.
 *
 * Why this exists: Kurier reporting `Aggregated` means zkVerify aggregated
 * the proof — NOT that the root has landed on Horizen's proxy. That
 * distinction was benign on Base Sepolia (the relayer pushes during
 * `Aggregated`, see the status semantics note in prover-service's
 * `kurier/schemas.ts`), so the original code submitted immediately. On
 * Horizen testnet the publish lags, and submitting into that window costs a
 * reverted tx: the pool's internal `verifyAndConsume` calls
 * `proxy.verifyProofAggregation`, gets `false`, and reverts with
 * `AggregationVerifyFailed()` (0x79993b73).
 *
 * `verifyProofAggregation` is `view`, so this dry-run is free apart from RPC
 * round-trips.
 *
 * Returns `true` once the proxy accepts the witness. On timeout returns
 * `false` rather than throwing: the caller still attempts the tx, so a proxy
 * that answers differently under `eth_call` than in execution — or a chain
 * whose publish we simply failed to observe — degrades to the old behaviour
 * instead of turning a would-be success into a hard failure.
 */
async function waitForAggregationOnChain(
  proof: AggregationProofTuple,
  publicClient: ReturnType<typeof getChainClients>["publicClient"],
  zkVerifier: Address,
): Promise<boolean> {
  let proxyAddress: Address;
  try {
    proxyAddress = (await publicClient.readContract({
      address: zkVerifier,
      abi: ZK_VERIFIER_ABI,
      functionName: "proxy",
    })) as Address;
  } catch {
    // Can't locate the proxy — skip the gate rather than block the tx.
    return false;
  }

  const deadline = Date.now() + PROXY_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const ok = (await publicClient.readContract({
        address: proxyAddress,
        abi: AGGREGATION_PROXY_ABI,
        functionName: "verifyProofAggregation",
        args: [
          proof.domainId,
          proof.aggregationId,
          proof.leaf,
          proof.merklePath,
          proof.leafCount,
          proof.leafIndex,
        ],
      })) as boolean;
      if (ok) return true;
    } catch {
      // Transient RPC failure — treat like a negative and retry.
    }
    await sleep(PROXY_POLL_INTERVAL_MS);
  }
  return false;
}
