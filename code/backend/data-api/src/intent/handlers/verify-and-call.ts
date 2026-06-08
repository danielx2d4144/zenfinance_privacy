import type { Pool } from "pg";
import type { Abi, Address, Hex } from "viem";

import { getChainClients } from "../../chain/anvil.js";
import { setMockProxyAllowed } from "../../chain/mock-proxy.js";
import type { AggregationProofTuple } from "../../chain/zk-verifier.js";
import { withChainLock } from "../../chain/mutex.js";
import { insertJobWithTx, updateIntentStatus, type IntentRow } from "../state.js";
import { submitAndWait, type AggregationReceipt } from "../kurier-poll.js";
import type { CircuitName } from "../vk-registry.js";

const ZERO_ROOT: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

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
 *   2. submitAndWait stub — returns a synthetic AggregationReceipt
 *   3. updateIntentStatus(aggregated) — receipt available
 *   4. withChainLock(async () => {
 *        setAllowed on the mock proxy
 *        verifyAndConsume on ZkVerifier
 *        the caller-provided pool method (e.g., supplyAsset)
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

    const receipt = await submitAndWait({
      circuit: args.circuit,
      proof: args.proof,
      publicInputs: args.publicInputs,
    });

    await updateIntentStatus(pool, intent.id, "aggregated");

    const { account, publicClient, walletClient, mockProxy, domainId } =
      getChainClients();

    const aggregationProof = receiptToTuple(receipt, domainId);

    let depositHash: Hex;
    await withChainLock(async () => {
      // Step 1: open the synthetic aggregation slot on the mock proxy
      // so when the pool's internal verifyAndConsume calls
      // verifyProofAggregation, the proxy returns true.
      //
      // The pool contracts already invoke ZkVerifier.verifyAndConsume
      // themselves (e.g., ShieldedSupplyPool.supplyAsset:99). Calling
      // it ourselves would consume the replay slot first and make the
      // pool's internal call revert with AlreadyConsumed.
      await setMockProxyAllowed({
        proxyAddress: mockProxy,
        domainId: aggregationProof.domainId,
        aggregationId: aggregationProof.aggregationId,
        leafIndex: aggregationProof.leafIndex,
      });

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
