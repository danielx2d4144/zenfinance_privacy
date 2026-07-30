import { beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import {
  keyDerivationTypedData,
  sessionKeysFromSignature,
} from "../key-derivation.ts";
import { encryptMemo, NoteType } from "../memo-crypto.ts";
import { balanceCommitment, spendingPubkeyOf } from "../witness.ts";
import { bigIntToHex32 } from "../poseidon2.ts";
import { makeFetchLogs } from "../recovery-adapter.ts";
import { RecoveryScanner, recoverNotes } from "../recovery-scan.ts";

/**
 * M2 exit e2e against the REAL local stack (Anvil + deployed contracts):
 *
 *   deposit(token, amount, commitment, encryptedMemo) on-chain
 *     → wipe everything local
 *       → RecoveryScanner full-set sync from block 0
 *         → trial-decrypt memos with keys re-derived from the SAME
 *           wallet signature → the note is back, exact preimage.
 *
 * Runs only when Anvil (127.0.0.1:8545) has the stack deployed —
 * skips cleanly otherwise so the unit suite stays green in CI.
 */

const RPC = "http://127.0.0.1:8545";
const PRIVACY_ENTRY = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707" as Address;
const MOCK_USDC = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9" as Address;
const ANVIL_KEY_0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const ABI = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function deposit(address token, uint256 amount, bytes32 commitment, bytes encryptedMemo)",
  "function nextLeafIndex() view returns (uint32)",
]);

const publicClient = createPublicClient({ chain: foundry, transport: http(RPC) });

let stackUp = false;

beforeAll(async () => {
  try {
    const code = await publicClient.getCode({ address: PRIVACY_ENTRY });
    stackUp = !!code && code !== "0x";
  } catch {
    stackUp = false;
  }
});

describe("Anvil e2e — deposit with memo, wipe, recover from chain alone", () => {
  it("full roundtrip", { timeout: 60_000 }, async (ctx) => {
    if (!stackUp) {
      ctx.skip();
      return;
    }
    const account = privateKeyToAccount(ANVIL_KEY_0);
    const walletClient = createWalletClient({
      account,
      chain: foundry,
      transport: http(RPC),
    });

    // --- unlock ceremony (device 1) --------------------------------------
    const bind = {
      address: account.address,
      chainId: foundry.id,
      privacyEntry: PRIVACY_ENTRY,
    };
    const sig = await account.signTypedData(keyDerivationTypedData(bind));
    const keys = sessionKeysFromSignature(sig, bind);
    const pubkey = spendingPubkeyOf(keys.spendingKey);

    // --- build + submit the memo deposit ---------------------------------
    const amount = 123_456_789n; // distinctive
    const salt = 0x5eed0000000000000000000000000000000000000000000000000000c0den ^
      BigInt(Date.now()); // unique per run so reruns don't hit duplicate-commitment
    const commitment = balanceCommitment({
      assetId: 0n,
      amount,
      spendingPubkey: pubkey,
      salt,
    });
    const commitmentHex = bigIntToHex32(commitment) as `0x${string}`;
    const memo = await encryptMemo({
      viewingKey: keys.viewingKey,
      commitment: commitmentHex,
      secrets: { noteType: NoteType.Balance, assetId: 0n, amount, salt },
    });
    const memoHex = `0x${Buffer.from(memo).toString("hex")}` as `0x${string}`;

    const mint = await walletClient.writeContract({
      address: MOCK_USDC,
      abi: ABI,
      functionName: "mint",
      args: [account.address, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash: mint });
    const approve = await walletClient.writeContract({
      address: MOCK_USDC,
      abi: ABI,
      functionName: "approve",
      args: [PRIVACY_ENTRY, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash: approve });

    const leafBefore = (await publicClient.readContract({
      address: PRIVACY_ENTRY,
      abi: ABI,
      functionName: "nextLeafIndex",
    })) as number;

    const deposit = await walletClient.writeContract({
      address: PRIVACY_ENTRY,
      abi: ABI,
      functionName: "deposit",
      args: [MOCK_USDC, amount, commitmentHex, memoHex],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: deposit });
    expect(receipt.status).toBe("success");

    // --- device 2: NOTHING local. Re-derive keys from the same wallet ----
    const sig2 = await account.signTypedData(keyDerivationTypedData(bind));
    const keys2 = sessionKeysFromSignature(sig2, bind);
    expect(keys2.spendingKey).toBe(keys.spendingKey); // EOA determinism

    const scanner = new RecoveryScanner({
      fetchLogs: makeFetchLogs({ client: publicClient, privacyEntry: PRIVACY_ENTRY }),
      scanFloor: 0n,
    });
    const head = await publicClient.getBlockNumber();
    const view = await scanner.syncTo(head);

    expect(view.memos.length).toBeGreaterThan(0);

    const { notes, mismatched } = await recoverNotes({
      view,
      viewingKey: keys2.viewingKey,
      spendingKey: keys2.spendingKey,
    });

    expect(mismatched).toBe(0);
    const recovered = notes.find((n) => n.leafHex === commitmentHex.toLowerCase());
    expect(recovered).toBeDefined();
    expect(recovered!.preimage.amount).toBe(amount);
    expect(recovered!.preimage.salt).toBe(salt);
    expect(recovered!.preimage.leafIdx).toBe(leafBefore);
    expect(recovered!.spent).toBe(false);
  });
});
