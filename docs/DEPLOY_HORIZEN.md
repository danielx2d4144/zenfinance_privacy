# Deploying ZenFinance to Horizen testnet (2651420)

Runbook for `code/contracts/script/DeployHorizenTestnet.s.sol`. M3, Phase 1.

## Why this isn't the Anvil script with a different `--rpc-url`

`EmitTestEvents.s.sol` is the only other full-stack deploy script, and three things it
does are fine locally but disqualifying on a public chain:

| | Anvil script | This script |
|---|---|---|
| Verifier proxy | `MockVerifyProofAggregation` — returns whatever was whitelisted | the real zkVerify proxy `0x3098A697…8C21` |
| Deployer key | defaults to the world-known Anvil key `0xac0974…ff80` | `DEPLOYER_PRIVATE_KEY`, no default |
| Seed data | 50 synthetic `ProofConsumed` events | none |

The second one is the dangerous one: deploying with the public Anvil key hands
`DEFAULT_ADMIN_ROLE` to an address whose private key ships with Foundry. Anyone could
pause the protocol in the middle of a demo.

Everything else — the cross-contract role grants, the asset configs, the rate params — is
carried over unchanged, because that part was already right.

## Prerequisites

1. **Deployer key.** Already generated, stored **outside the repo** at
   `~/.zenfinance/horizen-deployer.env`:

   ```
   DEPLOYER_ADDRESS=0x5d8De68615Dd389234d44478Ca5B0f3356A9fd4F
   DEPLOYER_PRIVATE_KEY=0x…
   ```

   Never move this into the repo. Nothing reads it except a manual `source`.

2. **Gas.** Send ~0.05 ETH to `0x5d8De68615Dd389234d44478Ca5B0f3356A9fd4F` on Horizen
   testnet. The full deploy is ~23M gas; at the measured ~0.001 gwei that is a rounding
   error, so 0.05 is deliberate overkill.

   Check it landed:

   ```bash
   export PATH="$HOME/.foundry/bin:$PATH"
   cast balance 0x5d8De68615Dd389234d44478Ca5B0f3356A9fd4F \
     --rpc-url https://horizen-testnet.rpc.caldera.xyz/http
   ```

## Pre-flight against a fork of the real chain

Run the deploy against forked mainnet state before spending gas. This wires the stack to
the genuine proxy bytecode and asserts every role grant, asset config and seed price:

```bash
cd code/contracts
export PATH="$HOME/.foundry/bin:$PATH"
HORIZEN_TESTNET_HTTPS=https://horizen-testnet.rpc.caldera.xyz/http \
  forge test --match-contract DeployHorizenTestnetForkTest -vv
```

Expect 5 passing tests. Without `HORIZEN_TESTNET_HTTPS` the suite skips itself, so the
default offline `forge test` run stays deterministic.

It catches a wrong proxy address, a missing role grant, a bad asset config and a chain-id
mismatch. It cannot catch gas exhaustion — that's what the overkill funding is for.

## Deploy

```bash
cd code/contracts
export PATH="$HOME/.foundry/bin:$PATH"
set -a; source ~/.zenfinance/horizen-deployer.env; set +a

forge script script/DeployHorizenTestnet.s.sol:DeployHorizenTestnet \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --broadcast --slow
```

`--slow` sends one transaction at a time and waits for each receipt. On an L3 with ~1s
blocks the whole run is under a minute, and it avoids nonce races that would otherwise
leave the stack half-wired.

The script refuses to run if:

- `block.chainid != 2651420` (wrong RPC),
- the zkVerify proxy has no bytecode (dead address),
- `DEPLOYER_PRIVATE_KEY` is unset (fails in `vm.envUint`, no fallback),
- the deployer has ≤0.005 ETH.

## After the deploy

1. **Manifest.** `code/contracts/deployments/horizen-testnet-2651420.json` is written with
   every address plus `deploymentBlock`. That block is the M2 recovery-scan floor —
   `chain-config.ts` reads it as `NEXT_PUBLIC_HORIZEN_DEPLOY_BLOCK`, and getting it wrong
   means note recovery either misses notes or scans from genesis.

2. **Verify on Blockscout** so the addresses are readable to anyone Fradique sends:

   ```bash
   forge verify-contract <address> <src/Contract.sol:Contract> \
     --chain-id 2651420 \
     --verifier blockscout \
     --verifier-url https://horizen-testnet.explorer.caldera.xyz/api \
     --constructor-args $(cast abi-encode "constructor(...)" ...)
   ```

3. **Wire the env vars.** From the manifest, into `code/dapp/.env`:
   `NEXT_PUBLIC_HORIZEN_PRIVACY_ENTRY`, `NEXT_PUBLIC_HORIZEN_DEPLOY_BLOCK`,
   and the pool/registry addresses. Into `prover-service/.env`: `ZKVERIFIER_HORIZEN`.

4. **Start the price keeper.** `Oracle.MAX_STALENESS_WINDOW` is 3600s and the deploy seeds
   prices once. Without a heartbeat every borrow and collateral flow reverts within the
   hour. This is a Phase-3 Railway cron, but if you demo before that lands, push manually:

   ```bash
   cast send $ORACLE "pushPrice(uint8,uint128)" 0 100000000 \
     --rpc-url $HORIZEN_TESTNET_HTTPS --private-key $DEPLOYER_PRIVATE_KEY
   ```

## Faucet

`MockERC20.mint` is unpermissioned by design here — it doubles as the demo faucet, so a
visitor with an invite code can fund themselves without us running a faucet service:

```bash
cast send $TUSDC "mint(address,uint256)" $YOUR_ADDRESS 10000000000 \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http --private-key $YOUR_KEY
```

(`10000000000` = 10,000 tUSDC at 6 decimals.)
