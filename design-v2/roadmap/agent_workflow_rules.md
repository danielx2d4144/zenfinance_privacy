# Agent Workflow Rules

Rules the coding AI follows when implementing this protocol. These are
**discipline rules** — they keep the build honest, the user informed,
and the codebase consistent.

## Rule 0 — Read these rules at the start of every coding session

Before writing any code in any session, the coding agent:
1. Re-reads this file in full.
2. Re-reads the current day's section in `code_roadmap.md`.
3. Re-reads the relevant subsystem file(s) in `../subsystems/`.
4. Re-reads `progress_tracker.md` to know what was finished previously.

No exceptions. The cost is 3 minutes; the cost of skipping it is days
of off-design work.

---

## Rule 1 — No hallucination (THE MOST IMPORTANT RULE)

The coding agent does NOT invent:
- API endpoints, parameter names, function signatures of external services.
- Contract addresses, chain IDs, RPC URLs.
- Library version numbers, package names, import paths.
- Behaviour of dependencies the agent has not read.
- Field names, struct layouts, JSON schemas the agent has not verified.

When a fact is needed and not already verified:
- **Stop. Do not guess.**
- Either read the dependency's source / docs and verify, OR flag a
  decision to the user (Rule 2).

When citing a fact that came from a doc or repo, include the **path and
line** so it's verifiable: `// per referenced_repos/zkVerify_zkVerify/verifiers/tee/src/lib.rs:88`.

If an inference is unavoidable (e.g., reading source and concluding
something), mark it `[inference]` so a reviewer can spot-check.

**Reminder of the past failure mode:** in the design phase, the agent
inferred Kurier's TEE-submission shape without testing it. That became
Open Question Q1.2 — a real blocker that needed a testnet spike to
resolve. **Don't repeat that pattern in implementation.** If you can't
verify, you flag it.

---

## Rule 2 — Decisions require the user's explicit sign-off

When the coding agent encounters a fork in the road that the design
docs don't resolve, the agent:

1. **STOP coding immediately.** Do not pick the path silently.
2. **Notify the user with maximum visibility:**
   - Output a clear text message that starts with `🔔 DECISION NEEDED`.
   - Make sure the user has actually seen the question before moving on. If running in an automated agent harness, surface the question via whatever escalation channel exists.
3. **Explain the decision clearly:**
   - What are the options? (Usually 2-4.)
   - What's the tradeoff per option?
   - What's the agent's recommendation, and why?
   - What's the cost (time, scope, money) per option?
   - What does this decision affect downstream?
4. **Wait for the user's response.** Don't proceed; don't do "other work" that depends on the decision; don't pick a default and continue.
5. **When the user replies, record the decision in `progress_tracker.md`** with the date + the user's words verbatim. This becomes the durable record.

### What counts as a "decision"?

YES (escalate):
- Choosing between two libraries / approaches with different trade-offs.
- Naming a public-facing user-visible string.
- Setting a default value that affects user funds (e.g., risk parameters).
- Adding any new external service or API not in `architecture_context.md` §1.6.
- Deviating from a documented design in `../subsystems/`.
- Picking a wallet / network / address for a deployment.

NO (just do it):
- Routine variable naming consistent with `code_standard.md`.
- Implementation details fully specified in the subsystem doc.
- Standard test fixtures or sample data.
- Internal helper-function structure.

When in doubt, escalate. The cost of a 5-minute decision check is
trivial; the cost of an undone wrong choice is large.

---

## Rule 3 — External services / APIs require user authorization

If the implementation needs ANY external service NOT already approved
in `architecture_context.md` §1.6 (the table of approved Phase-7
external services), the agent:

1. **STOP. Do not sign up, do not paste API keys, do not configure.**
2. **Notify the user via a clear `🔌 EXTERNAL SERVICE NEEDED` message:**
   - What service is needed.
   - What it's for (one paragraph).
   - Why we can't do without it.
   - What credentials / API keys / accounts the user must provide.
   - Estimated cost (if any).
3. **Wait for the user to provide the credentials / approval.**
4. Only proceed after the credentials are visibly handed over.

### Examples of external services that REQUIRE this flow

- A new third-party RPC provider (e.g., switching from Caldera to Ankr for Horizen).
- A new oracle (we're approved for Stork only).
- A new alerting service (PagerDuty, Opsgenie, etc.).
- A new payment processor.
- A new audit firm engagement.
- A new domain name registration.

### Examples that do NOT need this flow

- A new npm package that's open-source, MIT-licensed, and already a
  transitive dep of an approved tool.
- A new local dev-only tool (e.g., `httpie` for local debugging).

---

## Rule 4 — Follow `code_roadmap.md` day-by-day

Each day of the 21-day plan has:
- A primary subsystem (or part of one).
- Specific deliverables.
- Specific references to `../subsystems/NN_*.md`.
- Required external services for that day.

The agent's pattern each day:

1. Read the day's section in `code_roadmap.md`.
2. Read the referenced subsystem file(s) in full.
3. Implement the day's deliverables.
4. Run the day's tests (per `subsystem_test.md`).
5. Update `progress_tracker.md` with what was done.
6. If everything in the day's section is complete, **notify the user**:
   "🎯 Day N complete. Today's deliverables: X, Y, Z. All tests pass.
   What's next?"
7. Wait for user direction before proceeding to day N+1.

Do NOT skip days. Do NOT combine days without user approval. Do NOT
work on tomorrow's deliverables before today's are complete and
acknowledged.

If a day's scope turns out to be too large to finish, **flag a decision
(Rule 2)** before going over.

---

## Rule 5 — Test after every implementation

After implementing a feature or subsystem, the agent **MUST** navigate
to `subsystem_test.md` and execute the tests defined for that
subsystem.

Required steps:
1. Read the subsystem's section in `subsystem_test.md`.
2. Run each test specified.
3. Record results (pass / fail / skipped + why) in `progress_tracker.md`.
4. If any test fails:
   - **Do not move on.**
   - Diagnose the failure.
   - Fix the issue.
   - Re-run the test.
   - If you can't fix it within reasonable time, flag a decision (Rule 2).
5. Only mark the subsystem complete when all defined tests pass.

If a test is impossible to run in the current environment (e.g., it
needs a service we don't have credentials for yet), note that in
`progress_tracker.md` as `SKIPPED — reason: ...`, surface it to the
user, and continue with whatever is testable.

---

## Rule 6 — One file at a time, atomically

When writing code:
- Edit one file, get it right, save it.
- Don't leave half-edited files across multiple files.
- After every meaningful change, the codebase should compile / lint / test (whatever the language requires).

When editing existing files:
- Read the file before editing.
- Edit with `Edit` tool surgical changes rather than full rewrites (preserves git diff readability).
- Re-read after editing if continuing in the same file across a long session — file state can drift.

---

## Rule 7 — Cite sources in code comments

When a piece of code implements a documented design decision, include
the citation in a comment:

```solidity
// Per S14 §3: linear-per-accrual approximation matches Aave/Compound v2 pattern.
function _accrue(uint8 assetId) internal {
    // ...
}
```

```typescript
// Per S13 §6.1: BorrowIntent schema; do not change without updating the schema.
const BorrowIntentSchema = z.object({ ... });
```

This makes the codebase self-auditing — anyone reading the code can
find the "why" without spelunking through Slack history.

---

## Rule 8 — No silent design drift

If implementation reveals that the design needs to change (the design
turns out to be wrong, infeasible, or incomplete), the agent does NOT
silently change the implementation away from the design.

The correct flow:
1. **Flag the drift** to the user with a `🛠️ DESIGN DRIFT` message:
   - What the design says.
   - Why the design can't be followed as-written.
   - What the agent recommends (3 options usually: stick close, modify
     design, abandon the affected feature).
2. **Get the user's decision.**
3. **Update the relevant `../subsystems/NN_*.md` file** with the
   agreed change.
4. **Then implement.**

Design and code stay in lockstep. Always.

---

## Rule 9 — Respect the layer boundaries

`architecture_context.md` §3 lists boundaries that must not be crossed.
The agent never:
- Puts a spending key in a backend log.
- Lets the subgraph initiate a state-changing call.
- Gives an EOA the `POOL_ROLE`.
- Cross-imports between subsystems beyond what the docs allow.

If a particular task seems to require crossing a documented boundary,
that's automatically a `🔔 DECISION NEEDED` (Rule 2).

---

## Rule 10 — Preserve the audit-relevant invariants

Per `architecture_context.md` §4 and `../subsystems/15_threat_model.md`
§11, the protocol has named invariants. Any code change that could
affect an invariant must:

1. Be obvious about it (comment + identify which invariant).
2. Include or update the test that verifies the invariant.
3. Be flagged in the PR description.

Example: changing `RateModel.accrue()` affects `I-SOLV-1`, `I-SOLV-2`,
`I-SOLV-3`. The PR for any such change must update the corresponding
invariant test.

---

## Rule 11 — Progress tracker is the source of truth for "done"

`progress_tracker.md` is the ONLY mutable file across the implementation.
Everything else (subsystem docs, code roadmap, design overview) is
**append-only or design-stable**.

Update `progress_tracker.md`:
- After every completed file in a subsystem.
- After every test run (pass/fail status).
- After every day's wrap-up.
- After every user decision (with the user's verbatim direction).
- After every external service approval.

If the tracker says something is done, it's done. If it says open, it's
open. No "I think we finished that yesterday but didn't update the
tracker" — if it's not in the tracker, it didn't happen.

---

## Rule 12 — Stop and ask if you don't understand the design

If the coding agent reads a subsystem `.md` file and doesn't fully
understand a paragraph, **stop and ask**. Don't paper over confusion
with code.

Phrase: `🤔 CLARIFICATION NEEDED on S0N §X: <quote the unclear sentence>.
What does this mean specifically in the context of <current task>?`

The cost of clarifying is small. The cost of building on top of
misunderstood design is enormous.

---

## Rule 13 — Time-budget per task (per `code_roadmap.md`)

Each day's scope is sized to fit in one focused session. If a task is
taking 2× the budgeted time:

- Stop.
- Diagnose what's slowing you down.
- Flag a `⏱️ TIME OVERRUN` message to the user with: what's stuck, what
  options exist (drop scope / extend / get help), recommended action.

Do NOT silently work through the night to "finish" — that's how things
get shipped half-baked.

---

## Rule 14 — Privacy of the user's data

The agent has access to the user's:
- Wallet addresses (in dev configs).
- API keys (when the user authorises them per Rule 3).
- Private keys (testnet only; never mainnet).

The agent treats these per `code_standard.md` §7 (logging rules):
- Never logged.
- Never echoed back to the user except when explicitly requested.
- Never committed to a repo (covered by `.gitignore`, but also as a discipline).
- Test fixtures use throwaway accounts only.

---

## Rule 15 — When the user goes silent

If the agent is waiting on a user decision per Rule 2 and the user hasn't
responded within a session:

1. **Stop coding.**
2. **Do not pick a default and proceed.**
3. **Do not invent a workaround that avoids the decision.**
4. Wait. If multiple sessions go by, the next session reads the open
   decision in `progress_tracker.md` and re-surfaces it.

The agent's discipline matters most precisely when it would be easiest
to silently proceed. Don't.

---

## Rule 16 — Honesty about progress

The agent reports progress accurately. No:
- "Should be working" (either it is or it isn't).
- "Mostly done" (either it passes the day's tests or it doesn't).
- "I think this is right" (verified or unverified).

Standard wrap-up format:
```
✅ Completed: <list>
🧪 Tested: <list with pass/fail/skipped>
🚧 In-progress: <list with status>
🔔 Decisions pending: <list>
🔌 External services pending: <list>
❓ Open questions: <list>
```

---

## Rule 17 — The agent is not the final arbiter

The user is the final decision maker on:
- Product scope.
- External service choices.
- Risk acceptance.
- Mainnet readiness.
- Audit firm selection.
- Launch timing.

The agent's role is to: implement what's been agreed, surface what
needs deciding, explain trade-offs, and never over-step. Even when
the agent thinks it knows better.

---

## Rule 18 — When a rule conflicts with the design docs

If a rule here seems to conflict with a subsystem doc, the agent flags
the conflict to the user (per Rule 2). The user decides which wins.
Until then, the agent does not silently follow one and abandon the
other.

---

## Rule 19 — Add to this file when patterns emerge

If the agent notices a recurring class of confusion or near-mistake
during implementation, the agent proposes a new rule (in a `🔔 DECISION
NEEDED` message): "I've hit X twice. Should we add a rule like Y?"

This file grows as we learn the project.

---

## Quick reference card (the agent's mental checklist before EVERY commit)

- [ ] Did I verify every external fact I'm relying on?
- [ ] Does this match the subsystem doc?
- [ ] Did I update `progress_tracker.md`?
- [ ] Did I run the test from `subsystem_test.md`?
- [ ] Are any new external services in this change pre-approved?
- [ ] Did I flag any decisions that arose during the work?
- [ ] Did I cite the design reference in code comments?
- [ ] Does the diff cross any forbidden layer boundary?

If any answer is "no" or "I'm not sure" — fix it before committing.
