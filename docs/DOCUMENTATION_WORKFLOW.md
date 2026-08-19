# Documentation Implementation Workflow

**Goal:** Complete Phase 2 documentation systematically before moving to Phase 3 (hosting).

**Strategy:** One task at a time, verify each step, commit incrementally.

---

## Task Breakdown (Sequential Order)

### Task 1: Update VkRegistry.sol ✅ CRITICAL PATH
**Why first:** Contracts must be updated before deployment docs are accurate  
**Blocks:** Task 2 (deployment addresses), Task 5 (testing documentation)  
**Time:** 10 minutes  
**Risk:** Low (straightforward constant replacement)

**Steps:**
1. Read current `VkRegistry.sol`
2. Replace all 11 VK hash constants with Keccak hashes from `derive-vks.mjs` output
3. Update comments to note "Keccak format" instead of "Poseidon2"
4. Run `forge build --root code/contracts` to verify compilation
5. Run `forge test --root code/contracts` to verify tests pass
6. Commit: "Update VkRegistry.sol with Keccak VK hashes"

**Verification:**
```bash
cd code/contracts
forge test --match-contract VkRegistry
```

**Expected output:** All tests pass

---

### Task 2: Create docs/DEPLOYMENTS.md
**Why second:** Need updated VkRegistry before documenting contract addresses  
**Depends on:** Task 1  
**Blocks:** README update (references this file)  
**Time:** 15 minutes  
**Risk:** Low (documentation only)

**Steps:**
1. Create `docs/DEPLOYMENTS.md` with structure:
   - Current network (Horizen Testnet)
   - Contract addresses (from deployment artifacts)
   - VK hashes table (from `kurier-vk-hashes.ts`)
   - Verification links (block explorer)
   - Deployment date and commit hash
2. Add note: "Testnet addresses — will change before mainnet"
3. Include instructions for verifying contracts on explorer
4. Commit: "Add contract deployment documentation"

**Verification:**
- Check all contract addresses are valid (not 0x0)
- Check all VK hashes match `kurier-vk-hashes.ts`

---

### Task 3: Create CHANGELOG.md
**Why third:** Documents recent work while it's fresh  
**Depends on:** None (can run in parallel with Task 1-2)  
**Blocks:** None  
**Time:** 10 minutes  
**Risk:** None (documentation only)

**Steps:**
1. Create `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com) format
2. Document VK format fix as `[Unreleased]` section:
   - Added: Keccak VK format support
   - Changed: Switched from Poseidon2 to Keccak oracle hash
   - Fixed: Recovery scan cursor caching
3. List prior commits as `[0.1.0] - Initial testnet deployment`
4. Commit: "Add CHANGELOG documenting VK format fix"

**Verification:**
- Changelog entries match actual git history
- Dates are correct

---

### Task 4: Replace README.md
**Why fourth:** Needs DEPLOYMENTS.md and CHANGELOG.md to reference  
**Depends on:** Task 2, Task 3  
**Blocks:** None (but improves project presentation)  
**Time:** 5 minutes  
**Risk:** Low (backup old README first)

**Steps:**
1. Rename current `README.md` → `README_OLD.md` (backup)
2. Rename `README_NEW.md` → `README.md`
3. Check all internal links work (especially to `docs/DEPLOYMENTS.md`)
4. Verify markdown renders correctly on GitHub
5. Commit: "Update README with comprehensive project documentation"

**Verification:**
- All links in README resolve (no 404s)
- Tables render correctly
- Code blocks have proper syntax highlighting

---

### Task 5: Create docs/ARCHITECTURE.md
**Why fifth:** Most complex doc, benefits from having other docs complete  
**Depends on:** Tasks 1-4 (references them)  
**Blocks:** None  
**Time:** 30 minutes  
**Risk:** Medium (requires deep system understanding)

**Steps:**
1. Create `docs/ARCHITECTURE.md` with sections:
   - System Overview (diagram)
   - Core Problem Solved (table like Zendex)
   - Privacy Model (commitments, nullifiers, Merkle trees)
   - Component Architecture (frontend, backend, circuits, contracts)
   - Proof Flow (browser → data-api → Kurier → zkVerify → Horizen)
   - Data Flow (like Layrs information flow diagram)
   - Smart Contract Architecture (contract tree)
2. Include ASCII diagrams where helpful
3. Link to other docs (DEPLOYMENTS, CIRCUITS, GLOSSARY)
4. Commit: "Add comprehensive architecture documentation"

**Verification:**
- All component descriptions match actual implementation
- Diagrams are accurate
- Links to other docs work

---

## Execution Plan

### Session 1: Critical Path (30 min)
✅ **Task 1:** Update VkRegistry.sol (10 min)  
✅ **Task 2:** Create docs/DEPLOYMENTS.md (15 min)  
✅ **Task 3:** Create CHANGELOG.md (10 min)  
**Commit checkpoint:** "Phase 2 docs: contracts + deployment info"

### Session 2: User-Facing (35 min)
✅ **Task 4:** Replace README.md (5 min)  
✅ **Task 5:** Create docs/ARCHITECTURE.md (30 min)  
**Commit checkpoint:** "Phase 2 docs: complete core documentation"

---

## Parallel Track: Contract Redeployment (Separate Session)

**After Task 1 complete, can run in parallel:**

### Task 6: Redeploy ZkVerifier
**Why separate:** Requires wallet interaction, may need gas, separate concern  
**Depends on:** Task 1 (updated VkRegistry)  
**Blocks:** Live testing  
**Time:** 15 minutes + confirmation time  
**Risk:** Medium (blockchain interaction, costs gas)

**Steps:**
1. Ensure deployer wallet has testnet ZEN for gas
2. Read deployment script: `script/deploy/horizen/ZkVerifier.s.sol`
3. Dry-run: `forge script ... --rpc-url horizen`
4. Execute: `forge script ... --rpc-url horizen --broadcast`
5. Wait for confirmation (~10 blocks)
6. Verify on block explorer
7. Update `docs/DEPLOYMENTS.md` with new address
8. Update pool config if needed
9. Commit: "Redeploy ZkVerifier with Keccak VK hashes"

**Verification:**
```bash
cast call <NEW_VERIFIER_ADDRESS> "getVkHash(uint8)(bytes32)" 2 --rpc-url horizen
# Should return: 0x25acc035ddd29df9141476091055fe4928d50e836c07ea723b4b8c02fbe7f7c6
```

---

## Quality Gates (Before Marking Complete)

### ✅ Documentation Quality
- [ ] All markdown files render correctly on GitHub
- [ ] All internal links work (no 404s)
- [ ] All external links are valid
- [ ] Tables format properly
- [ ] Code blocks have syntax highlighting
- [ ] Spelling/grammar checked

### ✅ Technical Accuracy
- [ ] Contract addresses verified on explorer
- [ ] VK hashes match deployed VKs
- [ ] Architecture diagrams match implementation
- [ ] All code examples compile/run

### ✅ Completeness
- [ ] README covers all major topics
- [ ] DEPLOYMENTS has all contract addresses
- [ ] CHANGELOG documents recent changes
- [ ] ARCHITECTURE explains system design
- [ ] GLOSSARY defines all technical terms

### ✅ Git Hygiene
- [ ] Each task committed separately
- [ ] Commit messages follow convention
- [ ] No debug files committed
- [ ] `.gitignore` prevents doc artifacts

---

## Success Criteria

**Phase 2 Documentation is complete when:**

1. ✅ VkRegistry.sol has Keccak hashes
2. ✅ All contracts documented in docs/DEPLOYMENTS.md
3. ✅ CHANGELOG.md documents VK format fix
4. ✅ README.md is comprehensive and accurate
5. ✅ docs/ARCHITECTURE.md explains system design
6. ✅ GLOSSARY.md defines all terms
7. ✅ All quality gates pass
8. ✅ ZkVerifier redeployed with new VkRegistry
9. ✅ All docs committed to git

**Then we can:**
- Mark Task #28 complete
- Move to Phase 3 (hosting on Railway/Vercel)
- Test live proof submission with new contracts

---

## Rollback Plan (If Issues Arise)

**If VkRegistry changes break tests:**
```bash
git checkout HEAD~1 -- code/contracts/src/libraries/VkRegistry.sol
forge test
# Debug, fix, retry
```

**If deployment fails:**
- Check gas balance
- Check RPC endpoint
- Try different RPC if timeout
- Verify deployer key is correct

**If docs have errors:**
- Fix in place (docs-only changes don't break runtime)
- Amend commit if not pushed: `git commit --amend`

---

## Communication Checkpoints

**After Task 1-3 (Session 1):**
> "✅ Contracts updated with Keccak hashes, deployment docs created, changelog started. Ready for README update."

**After Task 4-5 (Session 2):**
> "✅ Documentation complete: README, ARCHITECTURE, and all supporting docs in place. Ready for contract redeployment."

**After Task 6 (Redeployment):**
> "✅ ZkVerifier redeployed with new VK hashes. Phase 2 documentation complete. Ready to test live proof submission!"

---

## Current Status

- [x] Documentation strategy defined
- [x] README_NEW.md created
- [x] GLOSSARY.md created
- [ ] **NEXT:** Task 1 — Update VkRegistry.sol
- [ ] Task 2 — Create docs/DEPLOYMENTS.md
- [ ] Task 3 — Create CHANGELOG.md
- [ ] Task 4 — Replace README.md
- [ ] Task 5 — Create docs/ARCHITECTURE.md
- [ ] Task 6 — Redeploy ZkVerifier

**Ready to start Task 1?** Let me know and I'll begin updating VkRegistry.sol.
