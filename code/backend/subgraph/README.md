# subgraph — Day 10

Goldsky-compatible subgraph indexing all on-chain state for the zenfinance
privacy lending protocol (S06 §3). Two manifest variants:

- `subgraph.base-sepolia.yaml` — Goldsky-hosted, indexes the contracts
  already deployed on Base Sepolia: ZkVerifier, RateModel, Oracle,
  AssetRegistry. Updated as new contracts land in Days 11–13.
- `subgraph.anvil.yaml` — rendered from
  `subgraph.anvil.yaml.template` by `npm run render-anvil`. Used by the
  local docker-compose stack for the T-10.1 test harness.

All mappings (AssemblyScript) live under `src/mappings/`. The schema is
fully forward-looking — entities for contracts that don't exist yet stay
empty until their data source is wired in.

## Goldsky deploy

```bash
goldsky login                       # one-off, uses Goldsky API key
npm run goldsky:build               # codegen + build into ./build
npm run goldsky:deploy              # → zenfinance-privacy/v0.1.0-day10
```

## Local T-10.1 harness

See `code/infra/data-stack/README.md` for the full sequence. Short form:

```bash
docker compose -f code/infra/data-stack/docker-compose.yml up -d
forge script EmitTestEvents --rpc-url http://localhost:8545 --broadcast
npm install
npm run render-anvil
npm run codegen:anvil
npm run build:anvil
npm run create-local
npm run deploy-local
npm run t10-1                       # PASS = 50 commitments + 50 aggregations + 2 markets
```

## Schema vs deployed contracts (Day 10 baseline)

| Entity                  | Source                                        | Status   |
|-------------------------|-----------------------------------------------|----------|
| `Aggregation`           | ZkVerifier (Base Sepolia)                     | live     |
| `Market`                | RateModel + Oracle + AssetRegistry            | live     |
| `Commitment`            | PrivacyEntry / ShieldedSupply / ShieldedPos.  | Anvil-only (no Base Sepolia deploy yet) |
| `InsuranceFundBalance`  | InsuranceFund                                 | Anvil-only |
| `LiquidationPosition`   | LiquidationBoard                              | Day 12-13 |
| `LiquidationEvent`      | LiquidationBoard                              | Day 12-13 |
| `Policy` / `AgentSession` | AgentAccount + PolicyRegistry              | Day 11+ |
