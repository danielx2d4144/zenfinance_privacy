import type { Address, Hex } from "viem";

import { getChainClients } from "./anvil.js";

/**
 * MockVerifyProofAggregation admin helper. On Anvil we use the mock
 * proxy deployed by EmitTestEvents.s.sol; its `setAllowed` admin path
 * lets the relayer mark a (domain, aggId, leafIndex) tuple as verifiable
 * before submitting `verifyAndConsume`.
 *
 * This is the Day-14b shortcut: instead of waiting 3-7 min for real
 * Kurier aggregation on Base Sepolia, we enable the synthetic
 * aggregation receipt the kurier-poll stub returned.
 *
 * Day 17 (testnet cut) removes this helper; real Kurier writes the
 * attestation to zkVerify's proxy on Base Sepolia, no admin shortcut.
 */

const MOCK_PROXY_ABI = [
  {
    type: "function",
    name: "setAllowed",
    stateMutability: "nonpayable",
    inputs: [
      { name: "domainId", type: "uint256" },
      { name: "aggregationId", type: "uint256" },
      { name: "leafIndex", type: "uint256" },
      { name: "ok", type: "bool" },
    ],
    outputs: [],
  },
] as const;

export interface AllowedTuple {
  proxyAddress: Address;
  domainId: bigint;
  aggregationId: bigint;
  leafIndex: bigint;
}

export async function setMockProxyAllowed(t: AllowedTuple): Promise<Hex> {
  const { publicClient, walletClient } = getChainClients();
  const hash = await walletClient.writeContract({
    address: t.proxyAddress,
    abi: MOCK_PROXY_ABI,
    functionName: "setAllowed",
    args: [t.domainId, t.aggregationId, t.leafIndex, true],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
