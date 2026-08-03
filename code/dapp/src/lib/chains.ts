/**
 * Legacy shim — the chain registry moved to `chain-config.ts` (M1.4).
 * Kept so existing imports (`wagmi.ts`, `useWallet.ts`) keep working.
 *
 * NOTE: the live Horizen testnet is chainId 2651420 on Caldera
 * (re-verified 2026-08-03). See chain-config.ts for the full record.
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
