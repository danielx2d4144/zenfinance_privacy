# MILESTONES.md — plan of record

Replaces the 21-day day-locked roadmap (`design-v2/roadmap/code_roadmap.md`, RETIRED).
Full plan detail: `~/.gstack/projects/danielx2d4144-zenfinance_privacy/Hi-main-resume-plan-20260729.md`.

## Process rules (what killed the last run, fixed)

1. **Git is the source of truth.** No tracker file may claim state git contradicts. GROUND_TRUTH.md is a map, updated when milestones close — never a gate.
2. **No daily human ack-gates, no wait-forever.** When the founder is unavailable, the agent proceeds on recommended defaults and records each choice in the decision log below.
3. **Milestones close on tests passing, not on days elapsing.** Scope changes get logged, not silently absorbed.
4. **No checkpoint may depend on a dead external.** External dependencies (chain endpoints, faucets, proxies) are probed in a time-boxed spike with a pre-declared FAIL branch — a FAIL reroutes the plan, never stalls it.
5. Honesty rules kept from agent_workflow_rules: never claim a test passed without running it; never invent chain data.

## M1 — RECONCILE (in progress, 2026-07-30)

- [x] M1.1 Gate 1 chain-health pull → **FAILED** (~20 daily actives vs 100; no TVL vs $5M). Whale-first is the active mainnet strategy; Horizen = funding channel. Re-check monthly.
- [x] M1.2 4 dirty files reviewed, founder approved "fix nits + commit" → committed as Day 14c-F (34dcf7e); forge 217/217 re-verified post-cleanup
- [x] M1.3 GROUND_TRUTH.md + MILESTONES.md + TODOS.md in repo
- [x] M1.4 Typed chain-config module (Anvil / Base Sepolia / Horizen testnet 845320009; kills dead 2651420) — pnpm build PASS
- [x] M1.5 ADR-001 (4337 execution-phase policy) + ADR-002 (memo-based notes) + circuit-salt verification (no vkHash re-pin needed)

## M2 — NOTE PERSISTENCE — the funds-visibility fix — CODE COMPLETE 2026-07-30

All library + wiring commits landed (M2.1–M2.6); live-Anvil e2e proves
deposit-with-memo → wipe → recover-from-signature-alone.
2026-07-30 close-out runs:
- [x] Relayer-path integration: memo intent → data-api → 4-arg deposit →
      confirmed → recovered from chain (scripts/relayer-memo-e2e.mts PASS;
      data-api t11-1/t11-2 3/3 PASS against live stack)
- [x] Automated browser smoke: all 5 routes 200, app content renders
- [x] FOUNDER QA passed 2026-07-30 (real wallet): unlock ceremony (2 sigs
      first setup), deposit→refresh→persists, wipe→recovery restores,
      two-tab read-only, private-mode banner + confirm gate.

**M2 CLOSED 2026-07-30.** Next Claude milestone: M3 (start-gated on Track 2).

Per ADR-002: IndexedDB cache + on-chain recovery as source of truth; random salt + encrypted
memo (additive `deposit` overload + event field); EIP-712→HKDF key derivation
(spending/viewing/storage); AES-GCM at rest; WAL for crash recovery; cross-tab locks;
full-set log sync (privacy-preserving recovery); shared commitment-matcher.
**Exit tests:** cross-stack vectors (TS == Noir == PoseidonIMT.sol), memo trial-decrypt
roundtrip, WAL crash points, wipe→recover e2e on Anvil, two-device simulation, multi-tab lock,
forge tests for the memo overload. Full list in resume plan §M2 + eng-review test plan.

## M3 — HORIZEN TESTNET DEPLOY + DEMO (~1 CC-week) — SPIKE PASSED 2026-08-03

**Start gate AMENDED 2026-08-03.** Original gate was "Thrive SUBMITTED + 5 calls BOOKED".
Horizen BD (Fradique) replied inviting docs + timeline in the dev channel, and the founder
publicly committed to an **August beta on Horizen** — so the deploy now unblocks the
relationship rather than waiting on it. Thrive + the 5 calls stay must-do (Track 2,
`docs/FOUNDER_ACTIONS.md`) but no longer block M3.

**Spike result: gates 1-3 PASS** (evidence in GROUND_TRUTH.md). Horizen testnet 2651420 is
live, canonical EntryPoint v0.7 is deployed, and the zkVerify aggregation proxy
`0x3098A697…8C21` is a live ERC-1967 proxy. **The Base Sepolia fallback branch is dropped —
the demo ships on Horizen.** Gate 4 (clean deploy run) is the remaining spike item and the
first task of M3.

Rest of M3 unchanged: deploy via chain-config; privacy-friendly waitlist (self-attested
size); demo flow deposit→shielded borrow; Sentry + 6-event funnel feeding Gate 2 evidence;
UI built on the approved Signal/Noise design system (see homepage repo).

## M4 — THRIVE + VALIDATION (founder work, parallel from now)

Thrive application; BD contact → written commitment + 3 whale intros; 5 Mom-Test calls scored
vs Gate 2 (≥2/5 concrete past pain); audit scoping quotes from 2-3 firms (Gate 3: no mainnet
without audit funding secured).

## Decision log (agent defaults taken while founder unavailable)

| Date | Decision | Basis |
|---|---|---|
| 2026-07-30 | Gate 1 honored → whale-first active, Horizen demoted to funding channel | Founder chose "Honor the gate" |
| 2026-07-30 | ADRs placed in `docs/adr/` (new dir) | Standard location; design-v2 is legacy |
| 2026-07-30 | M1.2 verdicts (agent recommendation, **pending founder approval**): commit all 4 dirty files as one "Day 14c-F" commit after fixing 1 stale comment in LendingForm.tsx; optionally delete dead `_seedDeposits` | Forensic review: pnpm build PASS, forge 217/217 PASS, no half-done work found |
