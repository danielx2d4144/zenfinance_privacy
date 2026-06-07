import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet, metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";

import { anvil, horizenTestnet } from "./chains";

/**
 * wagmi v3 config — single source of truth for chain/connector state.
 * Consumed by RainbowKit and the `useWallet()` hook (the only place in
 * the dapp that touches wagmi directly, per code_standard.md §4.6).
 *
 * NOTE: SubWallet has no first-party RainbowKit connector; users on
 * SubWallet connect through the generic "Injected" entry, which picks
 * up `window.ethereum` regardless of provider. That covers MetaMask,
 * SubWallet, Talisman, Rabby, etc.
 */
const projectId =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "missing-wc-project-id";

export const wagmiConfig = getDefaultConfig({
  appName: "Lending Protocol",
  projectId,
  chains: [anvil, horizenTestnet],
  ssr: true,
  wallets: [
    {
      groupName: "Recommended",
      wallets: [
        metaMaskWallet,
        coinbaseWallet,
        walletConnectWallet,
        injectedWallet,
      ],
    },
  ],
});
