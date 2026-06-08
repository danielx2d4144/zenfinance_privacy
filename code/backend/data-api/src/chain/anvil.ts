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
 * Anvil viem clients. The chain id is read from env so the same code path
 * works against the docker-compose Anvil (31337) and against a fresh
 * local Anvil if someone restarts the fixture.
 */
function anvilChain() {
  const cfg = getConfig();
  return defineChain({
    id: cfg.ANVIL_CHAIN_ID,
    name: "anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.ANVIL_HTTPS] } },
  });
}

export function getChainClients() {
  const cfg = getConfig();
  const transport = http(cfg.ANVIL_HTTPS);
  const chain = anvilChain();
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
    mockProxy: cfg.MOCK_PROXY_ADDRESS as Address,
    domainId: BigInt(cfg.ZK_DOMAIN_ID),
  };
}
