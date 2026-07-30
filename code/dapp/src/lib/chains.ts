/**
 * Legacy shim — the chain registry moved to `chain-config.ts` (M1.4).
 * Kept so existing imports (`wagmi.ts`, `useWallet.ts`) keep working.
 *
 * NOTE: the old Horizen testnet chainId 2651420 (Caldera) is DEAD.
 * The live Horizen testnet is chainId 845320009 — see chain-config.ts.
 */
export {
  anvil,
  baseSepolia,
  horizenTestnet,
  SUPPORTED_CHAINS,
  DEFAULT_CHAIN,
  getChainConfig,
  requireContract,
} from "./chain-config";
