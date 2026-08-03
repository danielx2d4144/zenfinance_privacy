import { defineChain, type Address, type Chain } from "viem";

/**
 * M1.4 — single typed chain-config module (plan of record, D9=2A).
 *
 * One entry per deploy target. Everything chain-scoped lives here:
 * RPC, explorer, contract addresses, 4337 EntryPoint, zkVerify proxy,
 * and the deployment block (the recovery scan floor for M2).
 *
 * Ground truth (see /GROUND_TRUTH.md), re-verified live 2026-08-03:
 *   - Anvil           31337   — daily dev loop
 *   - Base Sepolia    84532   — zkVerify/Kurier attestation E2E (Day 8)
 *   - Horizen testnet 2651420 — M3 target; spike gates 1-3 PASS
 *   - Horizen mainnet 26514   — has a zkVerify proxy too (post-audit path)
 *
 * NOTE: an earlier revision claimed 2651420 was dead and 845320009 was the
 * live testnet. That was WRONG, and it is the reverse: 2651420 answers on
 * Caldera (24M+ blocks, ~1s blocks) and is the chain zkVerify officially
 * supports; the *.appchain.base.org hostnames have no DNS A record.
 */

export interface ContractAddresses {
  privacyEntry?: Address;
  mockUsdc?: Address;
  oracle?: Address;
  rateModel?: Address;
  assetRegistry?: Address;
  shieldedSupplyPool?: Address;
  shieldedPositionPool?: Address;
}

export interface ChainConfig {
  chain: Chain;
  rpcUrl: string;
  explorerUrl?: string;
  contracts: ContractAddresses;
  /** Canonical ERC-4337 v0.7 EntryPoint, when present on the chain. */
  entryPoint?: Address;
  /** zkVerify aggregation proxy. Verified on Base Sepolia only (T-8.1);
   *  presence on Horizen testnet is the M3 spike's gate #3. */
  zkVerifyProxy?: Address;
  /** Block the stack was deployed at — M2 recovery scan floor. */
  deploymentBlock: bigint;
}

const ENTRYPOINT_V07 =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as Address;

const addr = (v: string | undefined): Address | undefined =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined;

// ---------------------------------------------------------------- chains

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

export const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC ?? "https://sepolia.base.org",
      ],
    },
  },
  blockExplorers: {
    default: { name: "Basescan", url: "https://sepolia.basescan.org" },
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
          "https://horizen-testnet.rpc.caldera.xyz",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Horizen Testnet Explorer",
      url: "https://horizen-testnet.explorer.caldera.xyz",
    },
  },
  testnet: true,
});

// ---------------------------------------------------------------- configs

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  [anvil.id]: {
    chain: anvil,
    rpcUrl: anvil.rpcUrls.default.http[0],
    contracts: {
      privacyEntry: addr(process.env.NEXT_PUBLIC_ANVIL_PRIVACY_ENTRY),
      mockUsdc: addr(process.env.NEXT_PUBLIC_ANVIL_MOCK_USDC),
      oracle: addr(process.env.NEXT_PUBLIC_ANVIL_ORACLE),
      rateModel: addr(process.env.NEXT_PUBLIC_ANVIL_RATE_MODEL),
      assetRegistry: addr(process.env.NEXT_PUBLIC_ANVIL_ASSET_REGISTRY),
      shieldedSupplyPool: addr(
        process.env.NEXT_PUBLIC_ANVIL_SHIELDED_SUPPLY_POOL,
      ),
      shieldedPositionPool: addr(
        process.env.NEXT_PUBLIC_ANVIL_SHIELDED_POSITION_POOL,
      ),
    },
    deploymentBlock: 0n,
  },
  [baseSepolia.id]: {
    chain: baseSepolia,
    rpcUrl: baseSepolia.rpcUrls.default.http[0],
    explorerUrl: baseSepolia.blockExplorers!.default.url,
    contracts: {
      privacyEntry: addr(process.env.NEXT_PUBLIC_BASE_SEPOLIA_PRIVACY_ENTRY),
    },
    entryPoint: ENTRYPOINT_V07,
    zkVerifyProxy: addr(process.env.NEXT_PUBLIC_BASE_SEPOLIA_ZKVERIFY_PROXY),
    deploymentBlock: BigInt(
      process.env.NEXT_PUBLIC_BASE_SEPOLIA_DEPLOY_BLOCK ?? "0",
    ),
  },
  [horizenTestnet.id]: {
    chain: horizenTestnet,
    rpcUrl: horizenTestnet.rpcUrls.default.http[0],
    explorerUrl: horizenTestnet.blockExplorers!.default.url,
    contracts: {
      // Set by the M3 deploy (2026-08-03, block 24177251). Addresses are in
      // code/contracts/deployments/horizen-testnet-2651420.json, which is the
      // source of truth these env vars are copied from.
      privacyEntry: addr(process.env.NEXT_PUBLIC_HORIZEN_PRIVACY_ENTRY),
      mockUsdc: addr(process.env.NEXT_PUBLIC_HORIZEN_MOCK_USDC),
      oracle: addr(process.env.NEXT_PUBLIC_HORIZEN_ORACLE),
      rateModel: addr(process.env.NEXT_PUBLIC_HORIZEN_RATE_MODEL),
      assetRegistry: addr(process.env.NEXT_PUBLIC_HORIZEN_ASSET_REGISTRY),
      shieldedSupplyPool: addr(
        process.env.NEXT_PUBLIC_HORIZEN_SHIELDED_SUPPLY_POOL,
      ),
      shieldedPositionPool: addr(
        process.env.NEXT_PUBLIC_HORIZEN_SHIELDED_POSITION_POOL,
      ),
    },
    // Verified on-chain 2026-08-03: canonical v0.7 EntryPoint has ~16KB of
    // bytecode here (v0.6 is deployed too).
    entryPoint: addr(process.env.NEXT_PUBLIC_HORIZEN_ENTRYPOINT) ?? ENTRYPOINT_V07,
    // zkVerify aggregation proxy, from zkVerify's Supported Networks table
    // and verified on-chain: ERC-1967 proxy, implementation
    // 0x03225ff1ff4f1bac6e81bb6317006a509422d51c (non-zero).
    zkVerifyProxy:
      addr(process.env.NEXT_PUBLIC_HORIZEN_ZKVERIFY_PROXY) ??
      ("0x3098A6974649478f0133046e44105AA84e868C21" as Address),
    deploymentBlock: BigInt(
      process.env.NEXT_PUBLIC_HORIZEN_DEPLOY_BLOCK ?? "0",
    ),
  },
};

export const SUPPORTED_CHAINS = [anvil, baseSepolia, horizenTestnet] as const;

const DEFAULT_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID ?? "31337",
);

export const DEFAULT_CHAIN =
  SUPPORTED_CHAINS.find((c) => c.id === DEFAULT_CHAIN_ID) ?? anvil;

export function getChainConfig(chainId: number = DEFAULT_CHAIN.id): ChainConfig {
  const cfg = CHAIN_CONFIGS[chainId];
  if (!cfg) {
    throw new Error(
      `No chain config for chainId ${chainId} — supported: ${SUPPORTED_CHAINS.map((c) => c.id).join(", ")}`,
    );
  }
  return cfg;
}

/** Require a contract address; throws a loud, named error instead of
 *  letting an undefined address turn into a silent zero-address call. */
export function requireContract(
  name: keyof ContractAddresses,
  chainId?: number,
): Address {
  const cfg = getChainConfig(chainId);
  const a = cfg.contracts[name];
  if (!a) {
    throw new Error(
      `Contract "${name}" not configured for ${cfg.chain.name} (chainId ${cfg.chain.id}) — set the NEXT_PUBLIC_* env var`,
    );
  }
  return a;
}
