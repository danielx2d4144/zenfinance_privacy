# Day-10 local data stack

Single-host docker-compose stack for the subgraph e2e test (T-10.1) and
local REST/MCP development on Day 11.

## Bring up

```bash
docker compose -f code/infra/data-stack/docker-compose.yml up -d
docker compose -f code/infra/data-stack/docker-compose.yml ps
```

Wait until every row reports `healthy`.

## What runs

| Service       | Port | Purpose                                            |
|---------------|-----:|----------------------------------------------------|
| postgres      | 5432 | graph-node subgraph store                          |
| ipfs          | 5001 | graph-cli upload target                            |
| ipfs gateway  | 8030 | optional: browse uploaded manifests                |
| graph-node    | 8000 | GraphQL HTTP                                       |
| graph-node    | 8001 | GraphQL WS                                         |
| graph-node    | 8020 | admin (used by `graph create` / `graph deploy`)    |
| anvil         | 8545 | local EVM chain (chain id 31337, 1s block time)    |

## T-10.1 flow

1. Bring the stack up (above).
2. From `code/contracts/`: `forge script EmitTestEvents --rpc-url http://localhost:8545 --broadcast`
   — deploys all contracts on Anvil and emits 100 mixed events. Outputs
   `code/backend/subgraph/anvil-addrs.json`.
3. From `code/backend/subgraph/`:
   ```
   npm install
   npm run render-anvil
   npm run codegen:anvil
   npm run build:anvil
   npm run create-local
   npm run deploy-local
   ```
4. From `code/backend/subgraph/test/`: `npm run t10-1` (the e2e assertion
   script that polls graph-node sync, queries counts via GraphQL, and
   compares to the deploy script's manifest).

## Bring down

```bash
docker compose -f code/infra/data-stack/docker-compose.yml down -v
```

The `-v` drops Postgres + IPFS volumes; rerun from scratch.

## Caveats

- The `mainnet` network alias in `subgraph.anvil.yaml` matches the
  `ethereum: mainnet:http://anvil:8545` env on graph-node — they MUST be
  identical. graph-cli treats `mainnet` as a generic-EVM alias here; for
  Base Sepolia we use `base-sepolia` (matched by Goldsky's network list).
- Anvil's `--block-time=1` is the slowest stable setting that still
  guarantees distinct `block.timestamp` values across emitted events.
- The Foundry image's `cast` binary lacks `--rpc-url` autocomplete; the
  healthcheck uses an explicit `http://localhost:8545` instead.
