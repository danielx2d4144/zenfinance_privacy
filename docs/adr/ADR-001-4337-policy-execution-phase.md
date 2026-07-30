# ADR-001: ERC-4337 Policy Enforcement Moves to Execution Phase

Date: 2026-07-30 | Status: ACCEPTED (decided in /plan-ceo-review D20; implementation lands with the agent-runtime milestone)
Supersedes: design-v2/subsystems/03_smart_accounts_policies.md §validateUserOp policy check

## Context

The S03 spec had `AgentAccount.validateUserOp` read `PolicyRegistry` storage to enforce
the owner's policy during ERC-4337 validation. This violates ERC-7562 validation-phase
storage rules (validation may only touch the account's own storage), so canonical
bundlers reject such userOps. This would have hard-stalled the agent runtime work
(old roadmap Days 15-16).

## Decision

Split enforcement across the two 4337 phases:

- `validateUserOp`: checks ONLY signature validity + session-key validity/expiry
  (data held in the AgentAccount's own storage — rule-clean).
- `AgentAccount.execute()`: re-reads the policy from `PolicyRegistry` at execution
  time and reverts (`PolicyViolation(...)`) on any violation (per-asset caps,
  HF floor, expiry, target allowlist).

## Consequences

- A policy-violating userOp passes validation, gets included, and reverts at
  execution — the agent burns gas on the failed op. Acceptable: the violating
  party pays, and misbehaving agents are the case we're defending against.
- Policy updates and revocations stay simple registry writes with immediate
  effect — no session re-signing (the drawback of the policy-hash-in-signature
  alternative, which we rejected for revocation complexity).
- Execution-phase enforcement is the pattern audit firms know how to verify.

## Alternative rejected

Embed `policyHash` in the session-key signature and verify against calldata in
validation (no storage read). Gas-efficient but makes policy update/revocation
semantics significantly harder to get right; deferred unless bundler gas
filtering becomes a real problem.
