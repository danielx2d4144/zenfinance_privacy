# Running NoctFinance Locally

A complete walkthrough for getting the whole stack running on your own machine,
starting from a fresh clone. Two profiles are covered:

- **Profile A — Horizen testnet** (recommended): point the dapp and relayer at the
  live v3.0 contracts. No contract deployment needed.
- **Profile B — local Anvil**: deploy everything to a local chain. Fully offline
  except for proof aggregation.

Expect 45–90 minutes on a first run, most of it toolchain installation and
circuit compilation.

---

## 1. Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 22.x (**not** 23+) | `node --version` |
| npm | 10+ | `npm --version` |
| Foundry | latest | `forge --version` |
| Noir (`nargo`) | 1.0.0-beta.18 | `nargo --version` |
| Barretenberg (`bb`) | 3.0.0-rc.6 | `bb --version` |
| Docker + Compose | latest | `docker compose version` |
| Git | any recent | `git --version` |

The Node major version is enforced by `engines` in the backend packages. The
`nargo`/`bb` versions are pinned deliberately — a different `bb` produces a
different verification key, which will fail on-chain with `VkHashMismatch`.

### Install Node 22

Use [nvm](https://github.com/nvm-sh/nvm) (or [nvm-windows](https://github.com/coreybutler/nvm-windows)):

```bash
nvm install 22
nvm use 22
```

### Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
# restart your shell, then:
foundryup
```

On Windows, run this from Git Bash, not PowerShell.

### Install Noir and Barretenberg

```bash
# noirup — the Noir toolchain installer
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup --version 1.0.0-beta.18

# bbup — the Barretenberg installer
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash
bbup --version 3.0.0-rc.6
```

Verify both resolve to the pinned versions before continuing. If `bb --version`
reports anything other than `3.0.0-rc.6`, stop and fix it — every VK hash in the
repo was generated with that build.

---

## 2. Clone and install

```bash
git clone https://github.com/danielx2d4144/zenfinance_privacy.git
cd zenfinance_privacy
```

There is no root-level `package.json`; each package installs independently.

```bash
# Relayer dependency (must come first — data-api links it via file:)
cd code/backend/prover-service && npm install && cd ../../..

# Relayer
cd code/backend/data-api && npm install && cd ../../..

# Frontend
cd code/dapp && npm install && cd ../..

# Price keeper (optional, only if you want automated price refresh)
cd code/backend/price-keeper && npm install && cd ../../..
```

---

## 3. Compile the circuits

```bash
cd code/circuits
nargo compile --workspace
```

This produces a JSON artifact per circuit in `target/`. The dapp copies these
into its own `public/` directory automatically — `npm run dev` and `npm run build`
both run `scripts/copy-circuit-artifacts.mjs` first via a `pre` hook, so you do
not need to copy anything by hand.

To regenerate verification keys and print their hashes:

```bash
./scripts/print_vk_hashes.sh
```

If you changed a circuit, the printed hashes must be written into **both**:

- `code/contracts/src/VkRegistry.sol` (on-chain source of truth)
- `code/backend/data-api/src/vk-registry.ts` (relayer's pre-flight check)

A mismatch between these two produces `VkHashMismatch` at settlement.

---

## 4. Build and test the contracts

```bash
cd code/contracts
forge build
forge test
```

All tests should pass without any network access.

---

## 5. Start Postgres

The relayer needs Postgres to track intents so it can resume after a restart.
The repo ships a Compose stack:

```bash
cd code/infra/data-stack
docker compose up -d postgres
```

That exposes Postgres on `localhost:5432` with user `graph`, password `graph`.
Create the database the relayer expects:

```bash
docker exec -it data-stack-postgres \
  psql -U graph -d graphnode -c "CREATE DATABASE zenfinance_dataapi;"
```

If you already run Postgres locally, skip Docker and just create a database —
adjust `DATABASE_URL` in the next step to match your credentials.

For Profile B you will also want Anvil and the block explorer:

```bash
docker compose up -d          # postgres + ipfs + anvil + otterscan + graph-node
```

| Service | Port |
|---------|------|
| Postgres | 5432 |
| Anvil RPC | 8545 |
| Otterscan explorer | 5100 |
| graph-node GraphQL | 8000 |
| IPFS API | 5001 |

---

## 6. Configure the relayer (data-api)

Create `code/backend/data-api/.env`. **This file is gitignored — never commit it.**
Use `.env.example` as the annotated reference.

### Profile A — Horizen testnet

```env
PORT=8787
HOST=127.0.0.1
LOG_LEVEL=info

DATABASE_URL=postgres://graph:graph@localhost:5432/zenfinance_dataapi

# Shared secret between dapp and relayer. Any random string; must match
# NEXT_PUBLIC_API_KEY in the dapp.
API_KEY=<generate-your-own>

# Exact browser origins allowed to call the API.
CORS_ORIGINS=http://localhost:3000

CHAIN_HTTPS=https://horizen-testnet.rpc.caldera.xyz/http
CHAIN_ID=2651420

# The wallet that pays gas for settlement. Needs testnet ETH.
RELAYER_PRIVATE_KEY=<your-funded-testnet-key>

# v3.0 addresses (block 26008305)
PRIVACY_ENTRY_ADDRESS=0xF774Ef76f52C819aA1cD14385F4D4Bc04Ec8E14b
MOCK_USDC_ADDRESS=0xdE21524EADf00d726a69Ac5Ebd97cE02735d8391
SHIELDED_SUPPLY_POOL_ADDRESS=0xd3900432F473f9367DC837d403Dd04D3Dd629db0
SHIELDED_POSITION_POOL_ADDRESS=0x42e8e79a7C0071930dAb7569100a7B4f4A674d09
LIQUIDATION_BOARD_ADDRESS=0x139f5D6316f5c9C95Bb6070cC2710dBBD4a8C173
ZK_VERIFIER_ADDRESS=0x8c8C4c860EF9749D7BaF82C35ef78232BDbd5077

# Real proof path: browser -> Kurier -> zkVerify -> Horizen aggregation proxy.
ATTESTATION_MODE=kurier
MOCK_PROXY_ADDRESS=
ZK_DOMAIN_ID=175

KURIER_BASE_URL=https://relayer-api-testnet.horizenlabs.io/api/v1
KURIER_API_KEY=<your-kurier-key>
KURIER_POLL_INTERVAL_MS=5000
KURIER_POLL_TIMEOUT_MS=1200000
```

`MOCK_PROXY_ADDRESS` is intentionally empty. In `kurier` mode there is no mock
verifier in the path; a stale address here would silently reintroduce the
shortcut and make proofs appear to succeed without real verification.

### Getting the credentials you need

**Relayer private key** — generate a fresh keypair and fund it with Horizen
testnet ETH. Never reuse a mainnet key.

```bash
cast wallet new
```

**Kurier API key** — request one from Horizen Labs for the zkVerify testnet
relayer API (`relayer-api-testnet.horizenlabs.io`). Without it, proofs cannot be
submitted for aggregation and every operation will stall at the attestation step.

**API_KEY** — any random string; it only gates the relayer's HTTP surface.

```bash
openssl rand -base64 32
```

### Profile B — local Anvil

Same shape, but point at the local chain and use the addresses printed by the
deploy script (step 9):

```env
CHAIN_HTTPS=http://127.0.0.1:8545
CHAIN_ID=31337
RELAYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

That key is Anvil's well-known account #0 — safe locally, catastrophic anywhere else.

### Run migrations and start

```bash
cd code/backend/data-api
npm run build          # builds prover-service first, then data-api
npm run migrate:up
npm start              # http://127.0.0.1:8787
```

Use `npm run dev` for watch mode. Confirm it is up:

```bash
curl http://127.0.0.1:8787/health
```

---

## 7. Configure the frontend (dapp)

Create `code/dapp/.env.local`. See `.env.example` for the full annotated list.

### Profile A — Horizen testnet

```env
NEXT_PUBLIC_DEFAULT_CHAIN_ID=2651420
NEXT_PUBLIC_HORIZEN_TESTNET_RPC=https://horizen-testnet.rpc.caldera.xyz/http

# WalletConnect project id — free from https://cloud.reown.com
NEXT_PUBLIC_WC_PROJECT_ID=<your-walletconnect-id>

NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8787
NEXT_PUBLIC_API_KEY=<same-value-as-API_KEY-in-data-api>

NEXT_PUBLIC_HORIZEN_PRIVACY_ENTRY=0xF774Ef76f52C819aA1cD14385F4D4Bc04Ec8E14b
NEXT_PUBLIC_HORIZEN_MOCK_USDC=0xdE21524EADf00d726a69Ac5Ebd97cE02735d8391
NEXT_PUBLIC_HORIZEN_ORACLE=0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2
NEXT_PUBLIC_HORIZEN_RATE_MODEL=0xD03cE597a99Da3BA67e0D46c1d0243Cd5600F4f9
NEXT_PUBLIC_HORIZEN_ASSET_REGISTRY=0xDF0f2F7BF0D4eC09871E2cb1b10648561492dBff
NEXT_PUBLIC_HORIZEN_SHIELDED_SUPPLY_POOL=0xd3900432F473f9367DC837d403Dd04D3Dd629db0
NEXT_PUBLIC_HORIZEN_SHIELDED_POSITION_POOL=0x42e8e79a7C0071930dAb7569100a7B4f4A674d09
NEXT_PUBLIC_HORIZEN_ZKVERIFY_PROXY=0x3098A6974649478f0133046e44105AA84e868C21

# Note-recovery scan floor. Must be the deploy block, or recovery misses notes.
NEXT_PUBLIC_HORIZEN_DEPLOY_BLOCK=26008305

# Local-only admin panel at /admin
NEXT_PUBLIC_ENABLE_ADMIN=true
```

Anything prefixed `NEXT_PUBLIC_` is compiled into the browser bundle. Treat all
of these as public — `NEXT_PUBLIC_API_KEY` is not a secret, it only retires the
constant published in the repo when rotated.

`NEXT_PUBLIC_HORIZEN_DEPLOY_BLOCK` matters more than it looks: note recovery
scans forward from it. Set it too high and the dapp silently misses your notes;
set it far too low and unlock takes minutes.

### Start it

```bash
cd code/dapp
npm run dev            # http://localhost:3000
```

`predev` copies the compiled circuit artifacts automatically. If you see missing
artifact errors, re-run step 3.

---

## 8. Seed the oracle

**Nothing works until prices are fresh** — supply and borrow both read the Oracle
and revert with `PriceStale` (`0x0868dfcf`) after the 1-hour staleness window.

You need an address holding `MANAGER_ROLE`. If yours does not have it:

```bash
cd code/contracts
forge script script/GrantOracleManager.s.sol \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --broadcast --legacy
```

Then push prices:

```bash
forge script script/RefreshOraclePrices.s.sol \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --broadcast --legacy
```

Or use the admin panel at `http://localhost:3000/admin` with the admin wallet
connected.

Verify:

```bash
cast call 0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2 \
  "getPrice(uint8)(uint128)" 0 \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http
```

Because prices expire hourly, re-run the refresh before each testing session, or
leave a cron job running:

```bash
*/30 * * * * cd /path/to/code/contracts && forge script script/RefreshOraclePrices.s.sol --rpc-url $RPC_URL --broadcast --legacy
```

Background: [ORACLE-HYBRID-MODE.md](ORACLE-HYBRID-MODE.md)

---

## 9. Profile B only — deploy your own contracts

Add to `code/contracts/.env` (gitignored):

```env
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Deploy to Anvil:

```bash
cd code/contracts
forge script script/DeployLendingStack.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast
```

Or the full v3 stack with Stork to Horizen testnet:

```bash
forge script script/DeployHorizenTestnetV3_Stork.s.sol \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --broadcast --slow --legacy
```

`--legacy` is required on Horizen testnet — it does not accept EIP-1559
transactions.

After deploying:

1. Copy the printed addresses into `code/contracts/deployments/<name>.json`.
2. Update `code/dapp/.env.local` and `code/backend/data-api/.env`.
3. Set `NEXT_PUBLIC_HORIZEN_DEPLOY_BLOCK` to the new deploy block.
4. Initialize rate models: `forge script script/InitializeRateModelV1_3.s.sol --broadcast --legacy`
5. Grant the relayer `MANAGER_ROLE`: `forge script script/GrantOracleManagerToRelayer.s.sol --broadcast --legacy`
6. Seed the oracle (step 8).
7. **Clear browser storage** — see step 11. Stale IndexedDB against new contracts
   is the most common post-redeploy failure.

---

## 10. Get testnet funds

**Gas.** Fund your wallet with Horizen testnet ETH from the Horizen faucet.
Both your own wallet and the relayer wallet need a balance.

**Mock tokens.** Both testnet tokens have an open `mint()`:

```bash
# 1000 USDC (6 decimals)
cast send 0xdE21524EADf00d726a69Ac5Ebd97cE02735d8391 \
  "mint(address,uint256)" <YOUR_ADDRESS> 1000000000 \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --private-key <YOUR_KEY> --legacy

# 1 cbBTC (8 decimals)
cast send 0xaC9AB44D3233de8CFD560E5a31Ec9AC4678c0e79 \
  "mint(address,uint256)" <YOUR_ADDRESS> 100000000 \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http \
  --private-key <YOUR_KEY> --legacy
```

**Add Horizen testnet to your wallet:**

| Field | Value |
|-------|-------|
| Network name | Horizen Testnet |
| RPC URL | `https://horizen-testnet.rpc.caldera.xyz/http` |
| Chain ID | 2651420 |
| Currency | ETH |

---

## 11. Verify the full flow

With Postgres, the relayer, and the dapp all running, and prices fresh:

1. Open `http://localhost:3000`, connect your wallet on chain 2651420.
2. Unlock your spending key. The dapp scans from the deploy block and rehydrates
   the local Merkle trees. Watch the console for the hydration log:
   `[useSpendingKey] IMT hydrated: { entryCount: N, entryRoot: "0x..." }`
3. Deposit 100 USDC. Wait for `confirmed`.
4. Supply 50 USDC. Wait for `confirmed`.

Then confirm cross-session recovery — this is the path that used to break:

5. Log out, then unlock again with the same spending key.
6. Supply another 25 USDC. It should reach `confirmed` without a
   "Cannot satisfy constraint" error.

Confirm the local tree matches the chain. In the browser console after unlock:

```javascript
console.log(window.entryImt.currentRoot().toString(16));
```

```bash
cast call 0xF774Ef76f52C819aA1cD14385F4D4Bc04Ec8E14b "currentRoot()" \
  --rpc-url https://horizen-testnet.rpc.caldera.xyz/http
```

The two roots must match exactly.

### Run the test suites

```bash
cd code/contracts && forge test
cd code/dapp && npm test
cd code/backend/data-api && npm test
cd code/backend/prover-service && npm test
```

---

## 12. Troubleshooting

**`LocalIMT.proofFor: idx 0 out of range [0, 0)`** — the local Merkle tree is
empty, usually stale IndexedDB after a redeploy. Clear storage and re-unlock:

```javascript
await indexedDB.databases().then(dbs =>
  dbs.forEach(db => indexedDB.deleteDatabase(db.name)));
localStorage.clear();
sessionStorage.clear();
location.reload();
```

Full procedure: [IMT-SYNC-FIX.md](IMT-SYNC-FIX.md)

**"Cannot satisfy constraint" on supply/borrow** — the local tree disagrees with
the on-chain root, so the Merkle path in the witness is wrong. Compare roots as
in step 11, then clear storage and re-unlock.

**`PriceStale` / `0x0868dfcf`** — prices older than one hour. Re-run
`RefreshOraclePrices.s.sol`. Borrow needs *both* USDC and cbBTC fresh.

**`0xc5723b51` from the Oracle** — Stork has no data for that feed on Horizen.
Expected; hybrid mode should be handling it. Confirm the feed ID is zeroed:

```bash
cast call $ORACLE "storkFeedId(uint8)(bytes32)" 0 --rpc-url $RPC_URL
```

**`VkHashMismatch`** — the VK hash in `VkRegistry.sol` does not match
`vk-registry.ts`, or a circuit was recompiled with a different `bb`. Re-run
`code/circuits/scripts/print_vk_hashes.sh` and sync both files. Verify
`bb --version` is `3.0.0-rc.6`.

**`NullifierAlreadySpent`** — the commitment was already spent. Normal on a
retry after a successful settlement.

**Relayer exits on startup** — usually `DATABASE_URL`. Confirm Postgres is up and
the `zenfinance_dataapi` database exists, then re-run `npm run migrate:up`.

**CORS errors in the browser** — `CORS_ORIGINS` in the relayer must contain the
exact browser origin, including scheme and port. Restart the relayer after changing it.

**Proofs stall at attestation** — `KURIER_API_KEY` is missing or invalid, or
aggregation is slow. Timeout is 20 minutes by default; check relayer logs for the
Kurier job id.

**Circuit artifacts not found** — re-run `nargo compile --workspace` in
`code/circuits`, then restart the dev server so the `predev` copy hook runs.

**Node version errors** — the backend packages require Node 22.x exactly.
`nvm use 22`.

**Foundry fails on Horizen testnet** — add `--legacy`. The chain rejects
EIP-1559 transactions.

Known issues with root-cause writeups: [BUG-TRACKER.md](BUG-TRACKER.md)

---

## 13. Security notes for local runs

- `.env`, `.env.local`, and `.env.horizen` are gitignored. Keep it that way.
- Generate your own relayer key; never reuse a mainnet key on testnet.
- `RELAYER_PRIVATE_KEY` and `KURIER_API_KEY` are real secrets. Everything
  prefixed `NEXT_PUBLIC_` ships to the browser and is not.
- The admin panel (`NEXT_PUBLIC_ENABLE_ADMIN=true`) is for local use only. Leave
  it unset in any hosted deployment.
- Mock tokens have an unrestricted `mint()`. Testnet only, obviously.
