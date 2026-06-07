"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

import { useWallet } from "@/hooks/useWallet";

/**
 * Top bar with RainbowKit's ConnectButton (which is also the disconnect
 * + chain-switch UI). A one-line note explains which chain the dapp is
 * currently targeting; the user's connected chain is shown in the button.
 */
export function TopBar() {
  const { defaultChain, isConnected, isCorrectChain } = useWallet();
  return (
    <header className="w-full border-b border-white/10 bg-black/30 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold tracking-tight">Lending</span>
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-white/60">
            {defaultChain.name}
          </span>
          {isConnected && !isCorrectChain ? (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200">
              wrong network
            </span>
          ) : null}
        </div>
        <ConnectButton />
      </div>
    </header>
  );
}
