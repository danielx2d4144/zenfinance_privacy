import {
  createPublicClient,
  http,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";

import { getChainConfig, requireContract } from "./chain-config.ts";
import type { FetchLogsFn, ScanEvent, ScanEventName } from "./recovery-scan.ts";

/**
 * M2.6 — viem adapter between the chain and RecoveryScanner.
 *
 * One eth_getLogs per chunk, address-filtered to PrivacyEntry with NO
 * topic filter: we want the full event set (recovery privacy — the RPC
 * never learns which commitments we care about), and the scanner needs
 * MerkleRootUpdated ordering for the leaf-index join anyway.
 */

const PRIVACY_ENTRY_EVENTS = parseAbi([
  "event Deposited(address indexed token, address indexed from, uint256 amount, bytes32 commitment)",
  "event EncryptedMemo(bytes32 indexed commitment, bytes memo)",
  "event Withdrawn(address indexed token, address indexed to, uint256 amount, bytes32 nullifier)",
  "event BalanceSpent(bytes32 indexed nullifier)",
  "event BalanceCredited(bytes32 indexed commitment)",
  "event MerkleRootUpdated(bytes32 newRoot, uint32 nextLeafIndex)",
]);

const EVENT_NAMES = new Set<ScanEventName>([
  "Deposited",
  "EncryptedMemo",
  "Withdrawn",
  "BalanceSpent",
  "BalanceCredited",
  "MerkleRootUpdated",
]);

export function makeScanClient(chainId?: number): {
  client: PublicClient;
  privacyEntry: Address;
  scanFloor: bigint;
  chunkSize?: bigint;
} {
  const cfg = getChainConfig(chainId);
  return {
    client: createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }),
    privacyEntry: requireContract("privacyEntry", chainId),
    scanFloor: cfg.deploymentBlock,
    chunkSize: cfg.logScanChunkSize,
  };
}

/**
 * Transient-failure budget per chunk.
 *
 * The scanner keeps a resume cursor, so a thrown chunk is recoverable rather
 * than fatal -- but it surfaces to the user as "Recovery scan was interrupted"
 * and leaves balances visibly incomplete until the next unlock. A single flaky
 * response should not cost that. Observed in the wild: viem raising
 * "Cannot read properties of undefined (reading 'headers')", which is what an
 * undefined fetch response looks like from inside its HTTP transport.
 */
const CHUNK_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeFetchLogs(args: {
  client: PublicClient;
  privacyEntry: Address;
}): FetchLogsFn {
  return async (fromBlock, toBlock) => {
    let logs;
    for (let attempt = 1; ; attempt++) {
      try {
        logs = await args.client.getLogs({
          address: args.privacyEntry,
          events: PRIVACY_ENTRY_EVENTS,
          fromBlock,
          toBlock,
        });
        break;
      } catch (err) {
        if (attempt >= CHUNK_ATTEMPTS) throw err;
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
    const events: ScanEvent[] = [];
    for (const log of logs) {
      const name = log.eventName as ScanEventName | undefined;
      if (!name || !EVENT_NAMES.has(name)) continue;
      events.push({
        blockNumber: log.blockNumber ?? 0n,
        logIndex: log.logIndex ?? 0,
        name,
        args: log.args as Record<string, unknown>,
      });
    }
    return events;
  };
}
