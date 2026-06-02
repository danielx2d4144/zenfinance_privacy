# Progress — design-v2

- [x] README.md
- [x] architecture_overview.md
- [x] subsystems/01_shielded_pools.md
- [x] subsystems/02_zk_circuits.md
- [x] subsystems/03_smart_accounts_policies.md
- [x] subsystems/04_attestation_pipeline.md
- [x] subsystems/05_oracle_and_keepers.md
- [x] subsystems/06_data_layer.md
- [x] subsystems/07_human_frontend.md
- [x] subsystems/08_agent_runtime.md
- [x] subsystems/09_note_management.md
- [x] subsystems/10_governance_admin.md
- [x] subsystems/11_artifact_distribution.md
- [x] subsystems/12_privacy_entry_layer.md
- [x] subsystems/13_api_contract.md
- [x] subsystems/14_interest_and_apys.md
- [x] subsystems/15_threat_model.md          ← NEW
- [x] subsystems/16_performance.md           ← NEW
- [x] subsystems/17_device_support.md        ← NEW
- [x] integration.md
- [x] spikes/01_critical_path.md

## Notes

- **17 subsystems total.**
- S15 maps every threat to a concrete mitigation owned by a specific
  subsystem; audit-verifiable invariants enumerated; phased-rollout +
  audit plan + bug-bounty policy defined.
- S16 documents per-operation latency budget; 5 improvement options
  ranked by impact; realistic speed tiers (free / pro / premium / future).
- S17 specifies device-class benchmarking, server-assisted proving
  (Flavor A trusted server in v1, Flavor B TEE in v1.5+), mobile
  defaults, accessibility (WCAG 2.1 AA), i18n plan.

## What changed in implementation scope as a result of S15/S16/S17

- **New service to build in v1**: a server-side prover service alongside
  the MCP server (owned by [S06](subsystems/06_data_layer.md))
- **New design-time work**: WCAG 2.1 AA audit by Deque (~$10-15k);
  device-benchmark UX flow; i18n framework
- **Audit scope clarified**: 5 distinct audits planned (Solidity, ZK,
  Crypto, Infra, Legal) totaling **$230-410k**, plus continuous
  bug-bounty + WCAG audit
- **Phased rollout written**: 5 stages from alpha testnet to uncapped
  mainnet, gated on stability + audit + insurance fund seeding

## Open work before launch (pre-flight)

- **Q1 toolchain**: Spike 1 plan ready in `spikes/01_critical_path.md`.
- **Q2 ERC-4337**: confirm canonical EntryPoint on Horizen or deploy our own.
- **Q3 Solidity reproducibility**: deterministic Foundry build in pinned Docker.
- **Q4 anonymity-set bootstrap**: launch-day seeding strategy.
- **Q5 sensitivity analysis** on rate parameters.
- **Q6 settleReserves cadence**.
- **Q7 Browser prove time** for 13k-constraint circuit on reference devices
  (per [S17](subsystems/17_device_support.md)).
- **Q8 WCAG audit** before mainnet (per [S17](subsystems/17_device_support.md)).

## Estimated time-to-mainnet

8-12 months with 4-6 engineers + 2-3 audit firms + 1 accessibility audit
firm + legal counsel.

## Estimated budget

- **Engineering**: 4-6 engineers × 10 months ≈ $800k-$1.5M
- **Audits**: $230-410k (per S15 §13)
- **Bug bounty seed**: $50k initial pool
- **Infrastructure**: ~$5-10k/month operational (AWS, Goldsky, Pinata)
- **Legal**: $30-60k

**Total to audited mainnet: ~$1.2M-$2.2M**.
