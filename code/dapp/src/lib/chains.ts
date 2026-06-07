import { defineChain } from "viem";

/**
 * Chain registry — local Anvil now, Horizen testnet ready behind a flag
 * for Day 17 cut-over. The dapp picks the active chain from
 * NEXT_PUBLIC_DEFAULT_CHAIN_ID so we can switch without code changes.
 *
 * Horizen testnet is a Caldera L3 on Base Sepolia, chainId 2651420 —
 * see design-v2/roadmap/architecture_context.md §1.1.
 */

export const anvil = defineChain({
  id: 31337,
  name: "Anvil (local)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_ANVIL_RPC ?? "http://127.0.0.1:8545"],
    },
  },
  testnet: true,
});

export const horizenTestnet = defineChain({
  id: 2651420,
  name: "Horizen Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_HORIZEN_TESTNET_RPC ??
          "https://horizen-rpc-testnet.appchain.base.org",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Horizen Testnet Explorer",
      url: "https://horizen-explorer-testnet.appchain.base.org",
    },
  },
  testnet: true,
});

export const SUPPORTED_CHAINS = [anvil, horizenTestnet] as const;

const DEFAULT_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID ?? "31337",
);

export const DEFAULT_CHAIN = SUPPORTED_CHAINS.find(
  (c) => c.id === DEFAULT_CHAIN_ID,
) ?? anvil;
