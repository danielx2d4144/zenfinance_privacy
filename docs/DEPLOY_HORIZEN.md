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
     --verifier-url https://horizen-testnet.explorer.caldera.xyz/api/ \
     --constructor-args 0x<abi-encoded args> --watch
   ```

   Get the constructor args by stripping the creation bytecode off what was
   actually broadcast, rather than re-deriving them by hand:

   ```python
   # creation input = artifact bytecode ++ abi-encoded ctor args
   inp  = tx["transaction"]["input"]          # broadcast/.../run-latest.json
   code = artifact["bytecode"]["object"]      # out/<File>.sol/<Name>.json
   args = inp[len(code):]                     # assert inp.startswith(code) first
   ```

   Two traps, both hit during the M3 deploy:

   - **Read `out/<File>.sol/<Name>.json` directly, not `forge inspect`.**
     `forge inspect test/mocks/MockERC20.sol:MockERC20 bytecode` cannot resolve
     that path and returns *empty*, which makes `startswith` pass trivially and
     the whole 2997-byte creation code look like constructor args.
   - **Assert the prefix match.** Without it a mismatch is silent.

   Cross-check at least one against `cast abi-encode` — for the mocks,
   `cast abi-encode "constructor(string,string,uint8)" "ZenFinance Test USDC" "tUSDC" 6`
   reproduces the stripped bytes exactly.

   Confirm the result independently of forge, which reports "already verified"
   for contracts it merely skipped:

   ```bash
   curl -s https://horizen-testnet.explorer.caldera.xyz/api/v2/smart-contracts/<addr> \
     | python -c "import sys,json;d=json.load(sys.stdin);print(d['name'],d['is_verified'])"
   ```

3. **Wire the env vars.** From the manifest, into `code/dapp/.env.local`:
   `NEXT_PUBLIC_HORIZEN_PRIVACY_ENTRY`, `NEXT_PUBLIC_HORIZEN_DEPLOY_BLOCK`, and the
   pool/registry/oracle addresses (see `code/dapp/.env.example` for the full list —
   `chain-reader.ts` needs oracle, rate model and asset registry to build witnesses,
   not just the pools). Into `prover-service/.env`: `ZKVERIFIER_HORIZEN`.

   For data-api, write a separate **`.env.horizen`** instead of editing `.env`.
   dotenv does not override variables already present in the environment, so
   `set -a; source .env.horizen; set +a; npm start` takes precedence and the
   Anvil profile stays intact for local dev.

4. **Start the price keeper.** `Oracle.MAX_STALENESS_WINDOW` is 3600s and the deploy seeds
   prices once. Without a heartbeat every borrow and collateral flow reverts within the
   hour — this was observed for real: ~4 hours after the deploy, `getPrice` reverted
   `PriceStale(assetId, updatedAt, now, 3600)` for both assets.

   Use `backend/price-keeper`, not a manual `cast send`:

   ```bash
   cd code/backend/price-keeper
   npm run horizen:push-once   # one sweep — the Railway cron shape
   npm run horizen:keep        # long-running loop — for a local demo
   ```

   It signs with the **relayer**, which was granted `MANAGER_ROLE` on the Oracle
   (tx `0x17f7113d…18fe5`) specifically so the deployer key never has to reach a
   hosting dashboard — the deployer also holds `DEFAULT_ADMIN_ROLE`, and anyone
   with it can pause the protocol.

   The keeper pushes at 900s against a 1800s max age, so three consecutive
   failed runs still land inside the contract's 3600s window. If the spot feed
   is unreachable it re-pushes the last on-chain value rather than skipping:
   a repeated price keeps lending usable, a skipped round marches every flow
   toward a revert.

   Manual fallback, if you need one:

   ```bash
   cast send $ORACLE "pushPrice(uint8,uint128)" 0 100000000 \
     --rpc-url $HORIZEN_TESTNET_HTTPS --private-key $DEPLOYER_PRIVATE_KEY
   ```

## Deployed — 2026-08-03, block 24177251

Live on Horizen testnet (2651420), all verified on Blockscout. Admin is
`0x5d8De68615Dd389234d44478Ca5B0f3356A9fd4F`.

| Contract | Address |
|---|---|
| ZkVerifier | `0xb30323CAbcBC75Cb4F789232C4DAD3793f2A8AA5` |
| PrivacyEntry | `0xaFf6608e440799c669145997fC230d51404A5142` |
| ShieldedSupplyPool | `0x43c5Ba0B57b5fb99B09f34De89825335D82681f1` |
| ShieldedPositionPool | `0x2433D5ef60b0444A2830636e754417eA76C7FE87` |
| LiquidationBoard | `0xBB58b1457f6c486873FC85c42ED1380df475eff2` |
| AssetRegistry | `0x0D6097E8E5804Cd540D317B9A633AAB925d782A6` |
| RateModel | `0x32Db36d6FeDf7a1D4D0317C0AaD3b08B03eB8297` |
| Oracle | `0x852da28C9Bc35870eB01e2D49296b8c1E3204024` |
| InsuranceFund | `0xb53bfef209aCFD6Ae533B6aa72663bCf0e2861E0` |
| tUSDC (faucet) | `0xebb4B50494BFa79FF0B33ea927000aC48b0C2Fa1` |
| tcbBTC (faucet) | `0xc7845AF9A8262323602e7b6471ab600Cc4ce4d95` |
| zkVerify proxy (theirs) | `0x3098A6974649478f0133046e44105AA84e868C21` |

Confirmed on-chain after deploy: `ZkVerifier.proxy()` returns the real zkVerify
proxy, all four pools hold `CALLER_ROLE`, and both seed prices are set (USDC
`1e8`, cbBTC `6e12`). Total gas cost was ~0.0000000114 ETH — the 0.05 ETH of
funding is effectively untouched.

## Faucet

`MockERC20.mint` is unpermissioned by design here — it doubles as the demo faucet, so a
visitor with an invite code can fund themselves without us running a faucet service:

```bash
cast send $TUSDC "mint(address,uint256)" $YOUR_ADDRESS 10000000000 \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http --private-key $YOUR_KEY
```

(`10000000000` = 10,000 tUSDC at 6 decimals.)
