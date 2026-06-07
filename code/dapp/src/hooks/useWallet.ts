"use client";

import { useMemo } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";

import { DEFAULT_CHAIN, SUPPORTED_CHAINS } from "@/lib/chains";

/**
 * The single hook the dapp uses to access wallet state. Per
 * code_standard.md §4.6, no other component imports wagmi hooks directly.
 *
 * Exposes everything the UI needs in a flat shape: address, chain, an
 * `isCorrectChain` flag, sign + connect/disconnect actions, and a
 * `switchToDefault()` helper.
 */
export function useWallet() {
  const { address, isConnected, status, connector } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, error: connectError, status: connectStatus } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, status: switchStatus } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();

  const activeChain = useMemo(
    () => SUPPORTED_CHAINS.find((c) => c.id === chainId),
    [chainId],
  );
  const isCorrectChain = chainId === DEFAULT_CHAIN.id;

  return {
    address,
    isConnected,
    status,
    connector,
    chainId,
    activeChain,
    defaultChain: DEFAULT_CHAIN,
    isCorrectChain,

    connect,
    connectors,
    connectStatus,
    connectError,
    disconnect,

    switchToDefault: () => switchChain({ chainId: DEFAULT_CHAIN.id }),
    switchStatus,

    signMessageAsync,
  } as const;
}
