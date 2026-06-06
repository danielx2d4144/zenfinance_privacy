import type { Pool } from "pg";
import type { Address, Hex } from "viem";

import { getChainClients } from "../../chain/anvil.js";
import { withChainLock } from "../../chain/mutex.js";
import { insertJobWithTx, updateIntentStatus, type IntentRow } from "../state.js";
import type { z } from "zod";
import type { EntryDepositIntent } from "../schemas.js";

const ERC20_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const PRIVACY_ENTRY_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "commitment", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

/**
 * Live execution path for an `entry_deposit` intent on Anvil.
 *
 * Flow:
 *   1) UPDATE intent status -> proving (we're constructing the call)
 *   2) Ensure the relayer holds enough of the asset (mint into self),
 *      approve PrivacyEntry to spend it.
 *   3) UPDATE status -> userop_pending; submit deposit() tx, wait for receipt.
 *   4) UPDATE status -> confirmed; persist the tx hash on a jobs row.
 *
 * On any throw, status -> failed with a structured reason. The handler is
 * idempotent at the intent level: caller dedup happens at the
 * Idempotency-Key layer above this, not here.
 */
export async function handleEntryDeposit(
  pool: Pool,
  intent: IntentRow,
  body: z.infer<typeof EntryDepositIntent>,
): Promise<void> {
  const { publicClient, walletClient, account, privacyEntry, mockUsdc } = getChainClients();
  const amount = BigInt(body.amount);

  try {
    // Stage 1: proving (no proof in entry_deposit, but we want the state
    // to make sense to clients polling).
    await updateIntentStatus(pool, intent.id, "proving");

    // Serialize all chain writes through a single-flight mutex. viem's
    // auto-nonce races under concurrent handlers; see chain/mutex.ts.
    await withChainLock(async () => {
      // Stage 2: mint + approve.
      const mintHash = await walletClient.writeContract({
        address: mockUsdc as Address,
        abi: ERC20_ABI,
        functionName: "mint",
        args: [account.address, amount],
      });
      await publicClient.waitForTransactionReceipt({ hash: mintHash });

      const allowance = (await publicClient.readContract({
        address: mockUsdc as Address,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account.address, privacyEntry],
      })) as bigint;
      if (allowance < amount) {
        const approveHash = await walletClient.writeContract({
          address: mockUsdc as Address,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [privacyEntry, (1n << 256n) - 1n],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // Stage 3: submitted (we're broadcasting); wait for confirmation.
      await updateIntentStatus(pool, intent.id, "userop_pending");
      const depositHash = await walletClient.writeContract({
        address: privacyEntry,
        abi: PRIVACY_ENTRY_ABI,
        functionName: "deposit",
        args: [mockUsdc, amount, body.commitment as Hex],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
      if (receipt.status !== "success") {
        throw new Error(`deposit reverted (tx ${depositHash})`);
      }

      await insertJobWithTx(pool, intent.id, Buffer.from(depositHash.slice(2), "hex"), {
        txHash: depositHash,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
      });

      await updateIntentStatus(pool, intent.id, "confirmed");
    });
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await updateIntentStatus(pool, intent.id, "failed", reason.slice(0, 500));
  }
}
