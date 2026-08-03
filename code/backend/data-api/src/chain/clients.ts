import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getConfig } from "../config.js";

/**
 * viem clients for the destination chain.
 *
 * Everything is read from env, so the same code path serves the
 * docker-compose Anvil (31337) and Horizen testnet (2651420). This module was
 * `chain/anvil.ts` until M3; the contents barely changed, but the name was
 * actively misleading once the demo ran on a public chain.
 */
function destinationChain() {
  const cfg = getConfig();
  return defineChain({
    id: cfg.CHAIN_ID,
    name: cfg.CHAIN_ID === 31337 ? "anvil" : `chain-${cfg.CHAIN_ID}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.CHAIN_HTTPS] } },
  });
}

export function getChainClients() {
  const cfg = getConfig();
  const transport = http(cfg.CHAIN_HTTPS);
  const chain = destinationChain();
  const account = privateKeyToAccount(cfg.RELAYER_PRIVATE_KEY as Hex);
  return {
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ chain, transport, account }),
    privacyEntry: cfg.PRIVACY_ENTRY_ADDRESS as Address,
    mockUsdc: cfg.MOCK_USDC_ADDRESS as Address,
    shieldedSupplyPool: cfg.SHIELDED_SUPPLY_POOL_ADDRESS as Address,
    shieldedPositionPool: cfg.SHIELDED_POSITION_POOL_ADDRESS as Address,
    liquidationBoard: cfg.LIQUIDATION_BOARD_ADDRESS as Address,
    zkVerifier: cfg.ZK_VERIFIER_ADDRESS as Address,
    /** Only set in `ATTESTATION_MODE=mock`; undefined against a real proxy. */
    mockProxy: (cfg.MOCK_PROXY_ADDRESS || undefined) as Address | undefined,
    domainId: BigInt(cfg.ZK_DOMAIN_ID),
  };
}
