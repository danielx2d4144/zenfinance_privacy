"use client";

import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseAbi } from "viem";

/**
 * Admin panel — Oracle / RateModel management.
 *
 * GATED. This route is prerendered as public static content, so on a public
 * deployment anyone can reach the URL. The on-chain `DEFAULT_ADMIN_ROLE` check
 * is the real security boundary (a stranger's tx reverts), but shipping a
 * page of privileged-looking buttons on a public MVP is confusing at best.
 *
 * Set `NEXT_PUBLIC_ENABLE_ADMIN=true` to enable — locally or in a private
 * preview deployment. Left unset in production.
 */
const ADMIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_ADMIN === "true";

/**
 * V3 deployment (block 26008305). These were previously pinned to the v2.0
 * contracts, which are dead — every button silently targeted a contract
 * nothing reads. Same failure mode as BUG-TRACKER #6.
 */
const ORACLE_ADDRESS =
  (process.env.NEXT_PUBLIC_HORIZEN_ORACLE as `0x${string}` | undefined) ??
  "0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2";
const RATE_MODEL_ADDRESS =
  (process.env.NEXT_PUBLIC_HORIZEN_RATE_MODEL as `0x${string}` | undefined) ??
  "0xD03cE597a99Da3BA67e0D46c1d0243Cd5600F4f9";

const ORACLE_ABI = parseAbi([
  "function pushPrice(uint8 assetId, uint128 priceUsd1e8) external",
  "function grantRole(bytes32 role, address account) external",
  "function MANAGER_ROLE() view returns (bytes32)",
]);

const RATE_MODEL_ABI = parseAbi([
  "function initializeAsset(uint8 assetId, (uint128 baseRateRay, uint128 uOptimalRay, uint128 r0Ray, uint128 r1Ray, uint128 r2Ray) params) external",
]);

const MANAGER_ROLE = "0x241ecf16d79d0f8dbfb92cbc07fe17840425976cf0667f022fe9877caa831b08";

export default function AdminPage() {
  const { address } = useAccount();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const [status, setStatus] = useState("");

  // Hooks must run before this branch (React rules-of-hooks), so the gate
  // lives here rather than at module scope.
  if (!ADMIN_ENABLED) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-6">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-2 text-sm text-white/60">
          The admin panel is disabled on this deployment.
        </p>
      </div>
    );
  }

  const handlePushUsdcPrice = async () => {
    try {
      setStatus("Pushing USDC price...");
      writeContract({
        address: ORACLE_ADDRESS,
        abi: ORACLE_ABI,
        functionName: "pushPrice",
        args: [0, 100000000n], // USDC = $1.00
      });
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const handlePushCbBtcPrice = async () => {
    try {
      setStatus("Pushing cbBTC price...");
      writeContract({
        address: ORACLE_ADDRESS,
        abi: ORACLE_ABI,
        functionName: "pushPrice",
        args: [1, 6000000000000n], // cbBTC = $60,000
      });
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const handleInitializeUsdcRates = async () => {
    try {
      setStatus("Initializing USDC rate model...");
      writeContract({
        address: RATE_MODEL_ADDRESS,
        abi: RATE_MODEL_ABI,
        functionName: "initializeAsset",
        args: [0, {
          baseRateRay: 0n,
          uOptimalRay: 800000000000000000000000000n, // 80%
          r0Ray: 50000000000000000000000000n,       // 5%
          r1Ray: 100000000000000000000000000n,      // 10%
          r2Ray: 500000000000000000000000000n,      // 50%
        }],
      });
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const handleInitializeCbBtcRates = async () => {
    try {
      setStatus("Initializing cbBTC rate model...");
      writeContract({
        address: RATE_MODEL_ADDRESS,
        abi: RATE_MODEL_ABI,
        functionName: "initializeAsset",
        args: [1, {
          baseRateRay: 0n,
          uOptimalRay: 700000000000000000000000000n, // 70%
          r0Ray: 30000000000000000000000000n,       // 3%
          r1Ray: 80000000000000000000000000n,       // 8%
          r2Ray: 600000000000000000000000000n,      // 60%
        }],
      });
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const handleGrantRole = async () => {
    const relayer = "0xB19f1F29DdC0C5248DE5bA98dDa4f94f9a562707";
    try {
      setStatus(`Granting MANAGER_ROLE to ${relayer}...`);
      writeContract({
        address: ORACLE_ADDRESS,
        abi: ORACLE_ABI,
        functionName: "grantRole",
        args: [MANAGER_ROLE as `0x${string}`, relayer as `0x${string}`],
      });
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    }
  };

  if (isConfirming) setStatus("Waiting for confirmation...");
  if (isSuccess) setStatus(`Success! Tx: ${hash}`);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Admin Panel</h1>
        <p className="mt-1 text-sm text-white/60">Oracle management (DEFAULT_ADMIN_ROLE required)</p>
      </section>

      <div className="rounded-lg border border-white/10 bg-white/5 p-6 space-y-4">
        <div>
          <p className="text-sm text-white/70 mb-2">Connected: {address || "Not connected"}</p>
          <p className="text-sm text-white/70 mb-4">Admin (V3): 0x4c2923d698a79dd85E900BCD9fDDb3Ef4973041e</p>
        </div>

        <button
          onClick={handleGrantRole}
          disabled={isPending || isConfirming}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          1. Grant MANAGER_ROLE to Relayer
        </button>

        <button
          onClick={handlePushUsdcPrice}
          disabled={isPending || isConfirming}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          2. Push USDC Price ($1.00)
        </button>

        <button
          onClick={handlePushCbBtcPrice}
          disabled={isPending || isConfirming}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          3. Push cbBTC Price ($60,000)
        </button>

        <button
          onClick={handleInitializeUsdcRates}
          disabled={isPending || isConfirming}
          className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          4. Initialize USDC Rate Model
        </button>

        <button
          onClick={handleInitializeCbBtcRates}
          disabled={isPending || isConfirming}
          className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          5. Initialize cbBTC Rate Model
        </button>

        {status && (
          <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-white/90">{status}</p>
          </div>
        )}
      </div>
    </div>
  );
}
