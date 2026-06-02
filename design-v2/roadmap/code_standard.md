# Code Standards

How every unit of the build looks, regardless of subsystem or language.
The coding agent applies these consistently. If something is missing
here, default to the strictest interpretation that matches an existing
convention in the codebase.

## 1. Universal principles (every language, every layer)

### 1.1 Explicit over implicit
- No magic numbers — every literal value gets a named constant.
- No silent type coercion — explicit casts where a type changes.
- No hidden side effects in function names that look pure.

### 1.2 Fail fast and loud
- Validate inputs at function entry; revert / throw immediately if invalid.
- Never silently truncate, default, or swallow errors.
- Every error path includes an error message that identifies which input was wrong.

### 1.3 No dead code
- Don't leave commented-out code in commits. Use git history instead.
- Don't merge code paths that have no caller. If a function isn't called yet but will be next-day, mark with `// TODO(day-NN)`.

### 1.4 Comments explain WHY, not WHAT
- Don't restate what the code does (well-named identifiers do that).
- Do explain non-obvious invariants, workarounds, gotchas, or surprising design choices.
- Reference the relevant design-v2 subsystem doc when the choice has a documented rationale (e.g., `// see S14 §7 for reserveFactor derivation`).

### 1.5 Test alongside code
- Every new function gets at least one test before the PR.
- Every bug fix gets a regression test that fails on the bug and passes on the fix.
- Coverage target: ≥ 95% line coverage for contracts, ≥ 80% for backend services.

### 1.6 Reference design, not memory
- The coding agent references the relevant subsystem `.md` file at every step.
- When the design says one thing and the code does another, **the design wins** until explicitly updated.

## 2. Solidity

### 2.1 File organization
```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

// External imports
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

// Internal imports
import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";

// Errors
error InvalidAssetId(uint8 assetId);

// Events
event AssetEnabled(uint8 indexed assetId);

// Contract
contract Example is AccessControl {
    // constants → immutables → state → modifiers → constructor → external → public → internal → private
}
```

### 2.2 Naming
- Contracts: `PascalCase`, descriptive (e.g., `ShieldedPositionPool`, not `Pool`).
- Functions: `camelCase` for external/public; `_camelCase` for internal/private.
- Constants: `SCREAMING_SNAKE_CASE`.
- Storage variables: `camelCase`; prefix mappings with their purpose (`assetConfigs`, not `assets`).
- Errors: `PascalCase`, descriptive (`InvalidAssetId`, not `Err1`).
- Events: past-tense verbs (`AssetEnabled`, not `EnableAsset`).

### 2.3 Style
- Maximum line length 100 characters.
- One contract per file (exception: tiny interfaces under `interfaces/`).
- Custom errors over `require(... "string")` — saves gas, clearer.
- Use `unchecked { }` ONLY in inner loops with proven safety; comment why.

### 2.4 Mandatory patterns
- Every state-mutating external function wears `nonReentrant`.
- Every state-mutating external function wears `whenNotPaused` (unless explicitly exempted by design).
- Every privileged function wears the appropriate `onlyRole(...)` modifier.
- Every external function emits an event for state changes (auditability).
- Checks → effects → interactions order; never violate.
- Use `safeTransferFrom` / `safeTransfer` from OpenZeppelin's `SafeERC20` for all ERC-20 calls.

### 2.5 Forbidden patterns
- No `tx.origin` for auth.
- No `delegatecall` to user-supplied addresses.
- No `selfdestruct`.
- No raw `assembly` blocks without a comment explaining why a Solidity equivalent is impossible.
- No `now` keyword (use `block.timestamp`).
- No `block.number` for time-sensitive logic (use `block.timestamp`).
- No floating-point.

### 2.6 Foundry test conventions
- Test files mirror source: `src/Foo.sol` → `test/Foo.t.sol`.
- Test functions named `test_<scenario>` (passing) or `testRevert_<scenario>` (reverting) or `testFuzz_<scenario>` (fuzz).
- Use `setUp()` to deploy + initialize; avoid duplicate setup across tests.
- Fork tests live in `test/fork/` and are gated behind `forge test --fork-url $RPC`.

## 3. Noir (ZK circuits)

### 3.1 File organization
```
circuits/crates/borrow/
├── Nargo.toml
├── src/
│   ├── main.nr           # the circuit entry: fn main(...)
│   ├── position.nr       # Position struct + invariants
│   ├── accrue.nr         # interest accrual helper
│   └── health.nr         # health-factor check helper
└── Prover.toml.example
```

### 3.2 Naming
- Circuit entries named per the operation: `borrow`, `liquidate`, etc.
- Public inputs in declaration order matching the JSON intent payload (per S13).
- Private inputs grouped with their visible parameters.

### 3.3 Style
- One `fn main(...)` per circuit; helper functions in sibling files.
- Maximum 80 columns for circuit source (better for `nargo` error messages).
- Every assertion has a comment explaining what invariant it enforces.
- Public inputs at the bottom of the parameter list, prefixed `pub`.

### 3.4 Mandatory patterns
- Every state-transition circuit asserts: nullifier-of-input matches, new-commitment-matches-new-state, public inputs match recomputed values.
- Every multi-slot circuit walks ALL slots, not just the touched one — to refresh borrow indices uniformly.
- Use `assert(...)` for every invariant; never silent failure.

### 3.5 Forbidden patterns
- No `unconstrained` blocks in production circuits (only for testing helpers, marked).
- No external randomness; use deterministic `salt` derivation.
- No floating-point.

### 3.6 Test conventions
- Per-circuit `tests/` directory with `Prover.toml` inputs for happy path + each failure mode.
- Differential test: 100 random valid witnesses must all verify.
- Adversarial test: 100 random invalid witnesses must all fail.

## 4. TypeScript (backend, SDKs, dapp)

### 4.1 File organization
- One concept per file. If a file has more than ~3 distinct exports, split it.
- Index files (`index.ts`) only re-export; no logic.
- `src/lib/` for utility modules; `src/services/` for stateful services; `src/types/` for shared types.

### 4.2 Naming
- Files: `kebab-case.ts` for modules, `PascalCase.tsx` for React components.
- Functions: `camelCase`, descriptive verbs.
- Types / interfaces: `PascalCase`.
- Constants: `SCREAMING_SNAKE_CASE`.
- React component files: `PascalCase.tsx` matching the component name.

### 4.3 Style
- ESLint + Prettier enforced in CI (config in `.eslintrc` + `.prettierrc`).
- Maximum line length 100 characters.
- TypeScript `strict: true` mode. **No `any` allowed** — use `unknown` and narrow.
- Prefer `type` aliases for unions and simple shapes; `interface` for extensible object types.
- Use `readonly` aggressively for immutable data.

### 4.4 Mandatory patterns
- All external inputs (HTTP body, env vars, file contents) validated with `zod` (or equivalent) before use.
- All async functions return `Promise<T>`; never untyped.
- All errors are typed; throw `class FooError extends Error` with a discriminant field.
- All database queries parameterised; never string interpolation.
- All secrets via env var (loaded at process start, validated with zod).

### 4.5 Forbidden patterns
- No `any` (use `unknown` + narrowing).
- No `@ts-ignore` (use `@ts-expect-error` with explanation if absolutely needed).
- No mutation of function arguments.
- No `console.log` in production code paths (use the structured logger).
- No catch-all `try { } catch (e) { /* ignore */ }`.

### 4.6 React (dapp specifically)
- Functional components with hooks only — no class components.
- Server components by default; `'use client'` only where needed.
- One `useEffect` per concern; not multiple side effects bundled.
- Form state via `react-hook-form` + `zod` resolver.
- All wallet interactions through a single `useWallet()` hook.

### 4.7 Test conventions
- Vitest for unit tests; one test file per module (`foo.test.ts` alongside `foo.ts`).
- Playwright for browser E2E tests in `dapp/e2e/`.
- `describe` blocks group related cases; `it` cases assert single behaviours.

## 5. Python (sdk-py)

### 5.1 Style
- Black for formatting, ruff for linting.
- Type hints on every function signature.
- `pydantic` for all input/output models.

### 5.2 Naming
- Files: `snake_case.py`.
- Functions: `snake_case`.
- Classes: `PascalCase`.
- Constants: `SCREAMING_SNAKE_CASE`.

### 5.3 Test conventions
- `pytest` with one test module per source module.
- Coverage tracked; ≥ 80% target.

## 6. SQL / migrations

- Migrations are append-only; never edit a committed migration.
- Naming: `NN__description.sql` (e.g., `04__add_intent_status_index.sql`).
- Every migration is reversible (provide a `down` query in a sibling file).
- Foreign keys explicit; cascading deletes only with strong justification.
- Indexes documented in a comment above their `CREATE INDEX`.

## 7. Logging

- Structured JSON only; no free-form `console.log` / `print`.
- Required fields on every log line: `timestamp`, `service`, `level`, `event`, `correlation_id`.
- Levels: `TRACE` (dev only), `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`.
- Never log: spending keys, witness secrets, raw private keys, full attestation documents.
- Log: intent IDs, job IDs, on-chain tx hashes, error codes (per [S13 §8](../subsystems/13_api_contract.md)).

## 8. Documentation

- Every Solidity contract has a `/// @title` + `/// @notice` NatSpec block.
- Every exported TypeScript function has a JSDoc block with `@param` and `@returns`.
- Every Noir circuit has a top-of-file comment explaining what it proves.
- README per top-level directory.

## 9. Commit / PR conventions

- Conventional Commits: `feat(s01): add ShieldedSupplyPool deposit`, `fix(s04): preserve receiptBlockHash`, `test(s02): add fuzz harness`.
- One subsystem per PR where possible.
- PR description includes: what subsystem (S0X), which design doc references it, what tests prove it works, what's deliberately not done yet.
- All PRs require CI green + one human reviewer (or marked as `[no-review]` for clearly-trivial changes).

## 10. Reproducibility (per S11)

- Every Solidity build runs inside the pinned Foundry Docker image.
- Every circuit build runs inside the pinned Noir Docker image.
- CI builds emit SHA-256 of every artifact; PR checks compare to the previous build's hash and flag unexpected changes.

## 11. Security checklist (before merging any contract PR)

- [ ] `forge test` passes with new tests covering the new code.
- [ ] `forge coverage` shows ≥95% line coverage on the new file.
- [ ] Slither runs clean (no high/medium findings).
- [ ] Custom errors used instead of revert strings.
- [ ] `nonReentrant` + `whenNotPaused` on all state-mutating externals.
- [ ] All ERC-20 calls use `SafeERC20`.
- [ ] No new external dependencies without `agent_workflow_rules.md` approval.
- [ ] Audit-relevant invariants (per S15 §11) covered by an invariant test.

## 12. When in doubt

If you (the coding agent) hit a situation not covered here:
1. Read the relevant subsystem `.md` file.
2. Pattern-match to the closest existing code in the codebase.
3. If still unclear, flag a decision to the user per `agent_workflow_rules.md`.

**Never silently invent a convention.** Consistency across the codebase
is more important than any single local optimisation.
