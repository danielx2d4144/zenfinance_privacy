"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { ReactNode } from "react";

export function ConnectGate({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-6">
      <p className="text-sm text-white/70">{message}</p>
      <div className="mt-4 flex items-center gap-3">
        <ConnectButton />
        {children}
      </div>
    </div>
  );
}
