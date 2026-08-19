# CCN — 30-Day Validation Plan

**Goal.** Prove or kill the Confidential Credit Network thesis in 30 days with 5 disciplined customer-discovery conversations. Each conversation tests **one specific assumption** in `CCN_INVESTOR_MEMO.md`. We stop building if ≥2 of the 5 fail their kill criterion.

**Method.** Mom Test discipline (Rob Fitzpatrick): no pitching, no leading questions, no asking about hypotheticals. Ask about **the past** ("the last time you did X, what happened?") and about **specific behavior** ("show me how you did Y last week"). Track responses against pre-declared kill / continue criteria — written down before the call, not after.

**One person owns this.** A founder, not an analyst. Investor-grade conversations require an investor-grade interlocutor.

---

## The 5 conversations

| # | Target archetype | Specific lead profile | Tests | Kill / continue |
|---|---|---|---|---|
| 1 | **Securitize ecosystem partner** | BD or partner-integration lead at Securitize, or a broker-dealer in the Securitize Markets network | Distribution: will Securitize plug CCN in as a confidential collateral venue alongside Morpho/Drift? | Kill if: no path to listing exists for non-public collateral venues. Continue if: there is a defined process and a single named gatekeeper. |
| 2 | **Tokenized-fund LP** | An accredited ACRED or SCOPE holder (Coinbase Asset Management portfolio company, a family office, or a crypto-native fund) | Demand: do they actually want to borrow against their position privately, and at what spread? | Kill if: nobody we talk to has tried to borrow against the position, or all said "I would just sell." Continue if: ≥1 has actively tried and cited privacy as a blocker. |
| 3 | **Private credit fund admin** | Operations head at NAV Consulting, SS&C GlobeOp, Apex Group, or a tokenized-fund-specific admin | SaaS willingness-to-pay: is the auditor-disclosure dashboard a real budget line? | Kill if: respondents don't recognize Proof-of-Non-Rehypothecation as a problem and have no existing budget for "blockchain reconciliation." Continue if: ≥1 names a current vendor or internal project for the same problem. |
| 4 | **OCIO / treasury-automation firm** | A tokenized-RWA-focused OCIO, or an autonomous-treasury startup (aarna Finance archetype) | Agent-bounded-credit demand: would they deploy CCN as a venue for AgentAccount-mediated borrowing? | Kill if: their roadmap already routes through Base MCP wallet-level agents and they see no need for venue-level policy. Continue if: they cite policy enforcement, HF floors, or auditor visibility as unmet needs. |
| 5 | **Private-credit-savvy regulator or auditor** | A former SEC / FSB staffer now in industry, OR a Big-4 digital-asset audit partner | Compliance posture: is "selective disclosure with auditor opt-in" actually the right side of the regulatory line? | Kill if: respondents say the architecture still looks like a mixer to a regulator. Continue if: at least one says it is meaningfully better than non-opt-in privacy and names the specific test (e.g., FinCEN MSB classification) that decides it. |

---

## Week-by-week cadence

### Week 0 (pre-flight, ~3 days)

- **Lock the conversation guide** for each of the 5 archetypes (see below).
- **Build the lead list.** Target: 10 leads per archetype (5 to land 1). Sources:
  - LinkedIn Sales Navigator filters: "Securitize" + "Business Development" / "Partnerships"; "tokenized fund" + LP/allocator titles; "fund administrator" + "digital assets"; OCIO firms with crypto offerings; SEC/FSB alumni at law firms or industry groups.
  - Warm intros via Horizen team, zkVerify team, Aave delegates, prior Aztec investors.
  - Twitter/X DMs to authors of the RWA reports cited in the memo (Centrifuge, RedStone, Fensory).
- **Schedule outreach window:** 30 messages sent Monday of Week 1.

### Week 1 — Distribution + Demand (Conversations 1 + 2)

- **Mon–Tue:** Outreach blast for Conversations 1 and 2. Personalized message under 4 sentences. No deck attached.
- **Wed–Fri:** Land the first 2–3 calls. Run Conversation 1 and Conversation 2 scripts (below). Log to `validation_log.md`.
- **Friday EOD:** Pre-declared decision. If Conversation 1 (Securitize distribution) returns a hard no with no workaround, the venue thesis collapses and we pivot to the SaaS-only thesis (Conversations 3 + 5 become primary).

### Week 2 — SaaS + Agent (Conversations 3 + 4)

- **Mon–Tue:** Outreach for fund admins and OCIO firms. Cite specifics from Week 1 responses if they go in our favor.
- **Wed–Fri:** Run Conversation 3 and Conversation 4 scripts.
- **Friday EOD:** Compare Conversation 2 (LP demand) and Conversation 4 (OCIO demand) for overlap. If both name the same use case (private leverage on tokenized credit for treasury rebalancing), that is the wedge.

### Week 3 — Compliance (Conversation 5) + design-partner conversion

- **Mon–Tue:** Conversation 5 outreach. Schedule.
- **Tue–Wed:** Run Conversation 5 script. This conversation usually requires 60–90 minutes; do not rush.
- **Wed–Fri:** Go back to the warmest 2 leads from Weeks 1–2 with a concrete design-partner offer: free integration, 6-month exclusivity in their segment, co-marketing once mainnet ships. Target: **one signed design-partner LOI by end of Week 3.**

### Week 4 — Synthesis + decision

- **Mon–Wed:** Write up findings in `validation_findings.md`. One page per archetype. Include verbatim quotes only — no paraphrasing in the findings doc.
- **Thu:** Internal go / no-go review against the pre-declared kill criteria.
- **Fri:** Update `CCN_INVESTOR_MEMO.md` v2 with the validated wedge, real quotes, and (if the LOI lands) the named design partner.

---

## Conversation guides

Each guide opens cold ("I'm researching X, can you spend 25 minutes telling me how Y works at your firm?") and never reveals the CCN product until the last 5 minutes — and only if the respondent asks.

### Conversation 1 — Securitize ecosystem partner

**Stated frame:** "I'm researching how confidential collateral venues could integrate with tokenized-fund issuance. Can I learn how Securitize Markets evaluates new venue partners?"

Past-behavior questions:
1. The last time a new venue (Morpho, Drift, an Aave market) was listed for an ACRED-class collateral, what did the process look like end-to-end?
2. Who decided? How long did it take? What were the blockers?
3. Has any prospective partner ever proposed a venue with on-chain confidentiality of positions? If yes, how did the conversation go? If no, what do you think the reaction would be?
4. Today, when a Securitize-issued token holder asks "how do I borrow against this?", what do you tell them? What % of asks does that answer satisfy?
5. Is there a current line item or quarterly OKR around expanding the collateral-venue catalogue? Who owns it?

**Listening targets:**
- Concrete name of the gatekeeper for venue listings.
- Existence (or not) of a formal due-diligence track for venue partners.
- Whether confidentiality of positions is seen as a feature or a regulatory red flag internally.

**Kill criterion:** No formal process exists, OR the gatekeeper says venue-listing decisions are made by issuer (Apollo / BlackRock) and the issuer has no opinion on privacy.

**Continue criterion:** A named gatekeeper, a documented evaluation process, and at least an "interesting, we'd want to see the architecture" reaction.

### Conversation 2 — Tokenized-fund LP

**Stated frame:** "I'm a researcher studying how holders of tokenized private credit funds are using their positions in DeFi. Can I learn what you've actually done with your ACRED / SCOPE / KKR position?"

Past-behavior questions:
1. How did you originally size the position? What was the alternative you didn't choose?
2. Have you ever used the token as collateral in DeFi? If yes — walk me through the last time, including which venue, what spread, what gas, what disclosures you ended up making.
3. If no — what stopped you? Was privacy a factor or was it just lack of a venue / gas / UX?
4. When you imagine the position appearing on a public block explorer, indexed by Nansen or Arkham, what is the first concern that comes to mind? (Note whether they mention front-running, LP reporting, KYC leakage, competitor visibility — these are different motivations.)
5. Have you ever been asked by your LPs or fund admin to disclose specific positions? In what form?

**Listening targets:**
- Whether they have actually attempted public-venue collateral use.
- Whether privacy is a stated or revealed preference (revealed > stated).
- Whether they self-identify a spread they would pay for privacy.

**Kill criterion:** All respondents (≥3 of 5) say "I would just sell if I needed liquidity" OR have no privacy concern (they are happy to use Morpho).

**Continue criterion:** ≥1 respondent who has actively tried and cited privacy as the blocker, OR ≥2 who said "I wouldn't even try because of the visibility."

### Conversation 3 — Private credit fund admin

**Stated frame:** "I'm researching how fund admins are adapting to tokenized funds. Can I learn how reconciliation, NAV, and collateral verification work today for ACRED-class products?"

Past-behavior questions:
1. The last time a tokenized fund client asked about on-chain reconciliation, what was the actual ask and what did you build / not build?
2. Today, when you verify that a piece of collateral hasn't been pledged elsewhere, what does that process look like? Is it manual? Is there a vendor?
3. (After the MFS / Barclays double-pledging mention — see if they bring it up before you do) — does anything like that worry your team for tokenized assets?
4. Of your current tooling spend, how much goes to compliance / reporting vendors today? What categories?
5. If a vendor offered cryptographic proof that a specific token position has not been rehypothecated within a given venue, would that be a real budget line or a nice-to-have? Who would own that line?

**Listening targets:**
- A named existing vendor in the rehyp/reconciliation category (validates the budget exists).
- Recognition (or not) of double-pledging as a real risk in tokenized funds.
- Whether they think of selective disclosure as a real category.

**Kill criterion:** No respondent names rehyp risk as material for tokenized assets, AND no respondent has a budget line for blockchain compliance vendors.

**Continue criterion:** ≥1 names an existing vendor or internal project in the category, AND ≥1 expresses interest in a Proof-of-Non-Rehyp product.

### Conversation 4 — OCIO / treasury automation firm

**Stated frame:** "I'm researching how outsourced-CIO firms are thinking about autonomous tools for tokenized credit allocations. Can I learn what your stack looks like today?"

Past-behavior questions:
1. Walk me through the last allocation decision your team made on a tokenized credit position. Who decided, what tooling was used, how was it executed?
2. Do you currently use any agent / autonomous tooling? If yes, where does it have authority and where does it require a human? If no, what stopped you from adopting?
3. When you imagine giving an agent authority to borrow against a tokenized fund position, what enforcement mechanism would your compliance team require? On-chain policy? Off-chain monitor? Both?
4. Have you encountered Base MCP, Binance Agent Kit, or similar? What did you make of them? (Note whether they distinguish wallet-level from venue-level enforcement.)
5. Is there a current line item for "agent enforcement / policy tooling" or is that subsumed in compliance budget?

**Listening targets:**
- Whether they recognize venue-level vs wallet-level policy enforcement as different.
- Whether HF floors / auditor visibility are spontaneously named as requirements.
- Whether tokenized credit is a real allocation category for them or a thought experiment.

**Kill criterion:** Their roadmap is fully wallet-level (Base MCP), with no felt need for venue policy.

**Continue criterion:** They name HF / auditor / policy enforcement as a current pain or current gap.

### Conversation 5 — Regulator or auditor

**Stated frame:** "I'm researching the regulatory posture of selective-disclosure protocols for institutional DeFi. Can I learn how you and your peers are thinking about the difference between privacy-by-default and auditor-opt-in architectures?"

Past-behavior questions:
1. The last time you (or your firm) assessed a privacy-preserving protocol for institutional use, what was the protocol, what was the conclusion, and what was the decisive factor?
2. Where do you see the line between Tornado-style anonymity and Aztec-style selective disclosure under current US / EU rules?
3. Specifically for an auditor-opt-in-per-deposit architecture: what test would your team apply to decide if this is acceptable for a regulated LP? (Listen for: MSB / FinCEN classification, OFAC screening, FATF Travel Rule.)
4. Where does the FSB's May 2026 report sit in industry conversations you're in?
5. If we wanted to be the **first** confidential credit venue to pass a regulator review, what would you tell us to focus on?

**Listening targets:**
- A specific regulatory test or framework (not vague approval).
- Whether they distinguish per-deposit auditor opt-in from protocol-wide opt-in.
- Any named reference protocol they consider compliant (Railgun PPOI, Aztec selective disclosure).

**Kill criterion:** Respondent says the architecture is structurally indistinguishable from a mixer to a US regulator, and the EU position is no better.

**Continue criterion:** Respondent names a specific test and says the architecture has a credible path to passing it.

---

## Logging discipline

For every call:
- **Within 30 minutes**, write the 3 most surprising quotes verbatim to `validation_log.md`.
- **Within 24 hours**, add: respondent role, prior assumption being tested, kill/continue verdict for that assumption, follow-up commitment.
- **No paraphrasing** in the log. Paraphrase changes meaning; verbatim survives later re-reading.

---

## Decision matrix at Week 4

| Scenario | Decision |
|---|---|
| 4 or 5 Continue | Proceed with full memo. Raise on the validated wedge. Sign design partner. |
| 3 Continue | Proceed but rewrite the memo around the 3 validated wedges. Drop the 2 that failed. |
| 2 Continue | Major rewrite. CCN becomes a single-product startup around whichever 1–2 conversations survived. |
| ≤1 Continue | **Kill or pivot.** Either way, return to roadmap and re-position the existing consumer privacy DeFi protocol as the primary product. |

---

## What this validation plan deliberately does NOT do

- **No "would you use this?" hypothetical questions.** They invariably return yes and predict nothing.
- **No demo, no deck, no pricing slide in calls 1–4.** Sequence is discover → diagnose → propose. Pitching at minute 5 contaminates the rest of the conversation.
- **No outreach to investors during the 30 days.** A premature investor conversation locks in a thesis we haven't validated. Investors come after Week 4.
- **No more than 5 archetypes.** Six conversations is a research project; five is a forced decision.
