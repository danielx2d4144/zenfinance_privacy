# Coding Agent Guide — Privacy-Focused Lending Protocol Architecture

> This file lives next to `horizen-docs/` and `zkVerify-docs/`.
> Read it first, then execute every phase **in order**.

---

## 1. Mission

Design (not yet implement) the system architecture for a **privacy-focused
lending protocol** built on **Horizen** and **zkVerify** technology.

Your job is to:
1. Read and deeply understand both projects from their cloned docs.
2. Catalogue every relevant technology and every referenced external repo.
3. Reason about how those technologies compose into a lending protocol.
4. Produce a top-level architecture plus one `.md` per subsystem (each with a
   diagram), plus a final integration document.

---

## 2. Non-Negotiable Rules

1. **No hallucination.** Every technical claim must be traceable to a specific
   file in a cloned repo. If you cannot cite it, do not write it.
2. **Cite every fact.** Use the citation format in §9 below. Architectural
   reasoning that is *your own* must be labelled `[inference]` so it is
   distinguishable from cited facts.
3. **Strict serial execution.** Do not start a phase until the previous one is
   marked complete in `design/progress.md`.
4. **Ask before introducing external tech.** Anything not present in the
   cloned repos (e.g., AWS, Chainlink, IPFS, a specific L2) must be proposed in
   `design/open_questions.md` and approved by the user before it appears in any
   design document.
5. **No implementation code yet.** This task ends at architecture. Source-repo
   code snippets may be quoted (with citation) but you do not write the protocol
   itself in this pass.
6. **When in doubt, stop and ask.** Add to `design/open_questions.md` rather
   than inventing an answer.

---

## 3. Inputs (already on disk)

Already cloned by the user, next to this file:

- `horizen-docs/` — from <https://github.com/HorizenOfficial/horizen-docs>
- `zkVerify-docs/` — from <https://github.com/zkVerify/zkVerify-docs>

If either directory is missing, **stop and tell the user** — do not proceed.

---

## 4. Output Layout

Everything you produce lives under a single `design/` folder, plus a
`referenced_repos/` folder for cloned external repositories.

```
.
├── horizen-docs/                            # input (already exists)
├── zkVerify-docs/                           # input (already exists)
├── referenced_repos/                        # you will populate this in Phase 4
│   ├── <org>_<repo-1>/
│   ├── <org>_<repo-2>/
│   └── ...
└── design/                                  # all of your outputs go here
    ├── progress.md                          # phase-by-phase checklist
    ├── phase1_horizen_notes.md              # raw notes from Horizen docs
    ├── phase2_zkverify_notes.md             # raw notes from zkVerify docs
    ├── techstacks.md                        # consolidated key tech from both
    ├── referenced_repos_inventory.md        # every external repo linked in docs
    ├── repos_reference_techstacks.md        # what each referenced repo provides
    ├── horizen_implementation_patterns.md   # how Horizen code is implemented
    ├── zkverify_implementation_patterns.md  # how zkVerify code is implemented
    ├── open_questions.md                    # things you need user input on
    ├── architecture_overview.md             # top-level lending protocol design
    ├── subsystems/
    │   ├── 01_<subsystem-name>.md           # one file per subsystem, with diagram
    │   ├── 02_<subsystem-name>.md
    │   └── ...
    └── integration.md                       # how all subsystems interconnect
```

---

## 5. Phases (execute in this order)

### Phase 0 — Setup

1. Verify `horizen-docs/` and `zkVerify-docs/` both exist. If not, stop.
2. Create `design/` and `referenced_repos/`.
3. Create `design/progress.md` with a checkbox for every phase below (template
   in §6).
4. Mark Phase 0 ☑.

---

### Phase 1 — Read the Horizen docs

Goal: an accurate, citable picture of what Horizen is and what it offers.

1. Start from the docs index/README in `horizen-docs/` and walk the entire
   documented hierarchy.
2. For every page, append to `design/phase1_horizen_notes.md`:
   - The page title and source path.
   - What is it about? (1–3 sentences.)
   - What technologies, primitives, services, or APIs does it describe?
   - Any code snippets, config, or interfaces that may be relevant to a
     lending protocol — quoted with citation.
3. Whenever you see a GitHub URL or repository reference, record it (URL +
   the page that referenced it). You will use this list in Phase 4. Do not
   open those URLs yet.

Keep these notes **rich and citable** — they are your source material, not a
summary. Mark Phase 1 ☑.

---

### Phase 2 — Read the zkVerify docs

Same procedure as Phase 1, output to `design/phase2_zkverify_notes.md`. Also
record any GitHub URLs you encounter, for Phase 4.

Mark Phase 2 ☑.

---

### Phase 3 — Consolidate the tech stack

Write `design/techstacks.md` by distilling Phases 1 and 2. Structure:

```
# Tech Stacks

## Horizen
### <Capability 1 name>
- Description: …
- Why it may matter for a privacy lending protocol: …
- Source: [horizen-docs/...]

### <Capability 2 name>
…

## zkVerify
### <Capability 1 name>
…

## Composition points
Where Horizen and zkVerify naturally compose (cite both sides).
```

Every entry needs at least one citation. Mark Phase 3 ☑.

---

### Phase 4 — Inventory and clone referenced repos

1. Collect every GitHub URL recorded in Phases 1 & 2 into
   `design/referenced_repos_inventory.md`. For each entry record:
   - Full URL
   - Where it was referenced (doc file path + 1-line context)
   - Best guess at what it contains (from the surrounding doc text only — do
     not yet open the repo)
2. Clone every listed repo into `referenced_repos/<org>_<reponame>/` using
   `git clone`.
3. If a repo looks irrelevant or huge (e.g., a marketing site, a translations
   mirror), pause and ask the user before cloning.
4. If a repo is private/dead/404, note that in the inventory and continue.

Mark Phase 4 ☑.

---

### Phase 5 — Understand the referenced repos

For each repo under `referenced_repos/`, write a section in
`design/repos_reference_techstacks.md`:

```
## <org>/<repo>
- URL: …
- Purpose: …
- Key modules / contracts / APIs: …
- Relevance to the lending protocol: …
- Sources: [referenced_repos/<repo>/README.md], [referenced_repos/<repo>/src/...]
```

Order sections thematically (group by what they provide) or alphabetically —
your choice, but be consistent. Mark Phase 5 ☑.

---

### Phase 6 — Document implementation patterns

Produce two files:

- `design/horizen_implementation_patterns.md`
- `design/zkverify_implementation_patterns.md`

For each project, document **with cited code snippets** how typical
implementations look:

- How a client connects to or calls into the project.
- Standard contract / module layouts.
- Authentication, signing, proof generation/submission, verification, etc.
- Configuration patterns and required environment.
- SDKs and how they are invoked.

Format every snippet as:

````
*Source: horizen-docs/path/to/file.md (or referenced_repos/...)*
```<language>
<code>
```
````

Mark Phase 6 ☑.

---

### Phase 7 — Pause for clarification (HARD STOP)

Write `design/open_questions.md` with three sections:

1. **Unknowns** — things you could not determine from the docs.
2. **External tech proposals** — any non-Horizen / non-zkVerify service you
   believe the protocol needs. For each proposal:
   - Name and one-paragraph description.
   - The role it would play in the lending protocol.
   - Why nothing in Horizen/zkVerify covers this role (cite `techstacks.md`).
   - Possible alternatives.
3. **Design choices needing user input** — e.g., target chain(s), collateral
   model, oracle approach, liquidation policy, governance.

**Stop here. Do not start Phase 8 until the user has answered the questions in
this file.** When they answer, append their answers inline under each question
so the trail is preserved.

---

### Phase 8 — Top-level architecture

Once Phase 7 is resolved, write `design/architecture_overview.md`:

1. **Goal statement** — what this lending protocol does and exactly what
   "privacy-focused" means in this design.
2. **Actors** — borrowers, lenders, liquidators, verifiers, governance, etc.
3. **End-to-end user flows** — deposit, borrow, repay, liquidate, proof
   verification — narrated, not yet diagrammed in detail.
4. **High-level component map** — a Mermaid diagram (see §8):

   ````
   ```mermaid
   graph TB
     User --> AppLayer
     AppLayer --> ContractLayer
     ContractLayer --> zkVerifyBridge
     ...
   ```
   ````
5. **List of subsystems** to be detailed in Phase 9. Each subsystem you list
   here must get a corresponding file in `design/subsystems/`.

Mark Phase 8 ☑.

---

### Phase 9 — Subsystem designs

For every subsystem named in `architecture_overview.md`, create
`design/subsystems/NN_<subsystem-name>.md` (numbered `01`, `02`, … to fix
ordering). Each file must contain:

1. **Purpose** — what this subsystem owns.
2. **Role in the main protocol** — how it serves the overall lending flow.
3. **Internal components** — modules / contracts / services inside it.
4. **External interfaces** — what it exposes; what it consumes.
5. **Data model** — key state, structs, accounts.
6. **Security & privacy considerations** — including which zkVerify proofs
   apply and what they prove.
7. **Dependencies** — Horizen / zkVerify tech used, each with a citation back
   to `techstacks.md` or `repos_reference_techstacks.md`.
8. **Detailed diagram** — a Mermaid diagram showing internal structure and
   data flow within the subsystem.

Likely subsystems (final list comes from **your own** analysis, not this
list — this is only a prompt to your thinking):

- Smart contract layer
- Proof generation / submission layer
- zkVerify integration / verifier layer
- Off-chain coordinator or indexer
- User-facing application layer
- Oracle / pricing layer
- Storage layer
- Governance / parameter layer

Mark Phase 9 ☑ only after every subsystem listed in Phase 8 has its file.

---

### Phase 10 — Integration

Write `design/integration.md`:

1. **Master diagram** — one Mermaid diagram showing all subsystems and the
   wires between them.
2. **Cross-subsystem call table** — every A→B interaction: what data crosses,
   what trust assumption holds, what proof/verification (if any) is involved.
3. **Sequence diagrams** (Mermaid `sequenceDiagram`) for each main flow —
   deposit, borrow, repay, liquidate, proof verification — showing which
   subsystems touch which and in what order.
4. **Trust boundaries** — which components are trusted, which are
   trust-minimized via zk proofs, and where the boundaries sit.

Mark Phase 10 ☑.

---

## 6. `design/progress.md` Template

Create this file at the start of Phase 0 and update it at the end of every
phase:

```
# Progress

- [ ] Phase 0 — Setup
- [ ] Phase 1 — Horizen notes
- [ ] Phase 2 — zkVerify notes
- [ ] Phase 3 — techstacks.md
- [ ] Phase 4 — Referenced repos inventory + clones
- [ ] Phase 5 — repos_reference_techstacks.md
- [ ] Phase 6 — Implementation patterns
- [ ] Phase 7 — Open questions (BLOCKS until user answers)
- [ ] Phase 8 — Architecture overview
- [ ] Phase 9 — Subsystem designs
- [ ] Phase 10 — Integration
```

---

## 7. External Technology Policy

If during reasoning you conclude the protocol needs something not in Horizen
or zkVerify (e.g., AWS, Chainlink, IPFS, a specific L2, an MPC service):

1. Do **not** silently add it to any design doc.
2. Add a proposal entry in `design/open_questions.md` describing:
   - What the service is and what it does.
   - The role it would play.
   - Why nothing in `techstacks.md` covers that role.
   - Possible alternatives.
3. Wait for user approval before referencing it anywhere else.

---

## 8. Diagram Convention

All diagrams must be Mermaid code blocks **inside** the `.md` files. No
external image files. Use:

- `graph TB` / `graph LR` for component maps.
- `sequenceDiagram` for flows.
- `classDiagram` for data models when useful.
- `flowchart` for decision logic.

Subsystem diagrams should show:
- Internal components (boxes).
- Data flow direction (arrows, labelled).
- External interfaces drawn at the boundary.
- Trust boundary as a `subgraph` if relevant.

---

## 9. Citation Format

Use one of:

- `[source: horizen-docs/docs/foo/bar.md]`
- `[source: zkVerify-docs/docs/x.md#section]`
- `[source: referenced_repos/<repo>/path/to/file.ext:LINE]`

Every non-trivial claim must carry a citation. Mark your own architectural
reasoning with `[inference]` so it can be distinguished from cited facts at a
glance.

---

## 10. When You Get Stuck

- Ambiguous doc page → add to `open_questions.md`, continue.
- Missing/dead referenced repo → note in `referenced_repos_inventory.md`,
  continue.
- Tempted to invent a fact → **stop**, add to `open_questions.md`, ask the
  user.
- A subsystem you can't justify from cited tech → flag it in
  `open_questions.md` before writing the subsystem file.

---

## 11. Definition of Done

The task is complete when:

- `design/progress.md` has every phase ☑.
- Every file listed in §4 exists and is populated.
- Every subsystem listed in `architecture_overview.md` has a matching file
  under `design/subsystems/` with a Mermaid diagram.
- `design/integration.md` shows all subsystems and includes sequence diagrams
  for each main flow.
- `design/open_questions.md` has user answers recorded inline for every
  question.
- No file contains an uncited factual claim.
