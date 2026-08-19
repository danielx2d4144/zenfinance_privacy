# design-v2 — Reference Design Specs

**Status:** REFERENCE ONLY — Original design specifications (archived)  
**Current Source of Truth:** `GROUND_TRUTH.md` + actual codebase

---

This folder contains the original design specifications from an earlier iteration of NoctFinance. While much of the architecture was implemented, some details have diverged during development.

**Use this folder for:**
- ✅ Understanding original design decisions
- ✅ Reference for subsystem specifications
- ✅ Threat model and security considerations

**Do NOT use this folder for:**
- ❌ Current implementation details (see `GROUND_TRUTH.md`)
- ❌ Contract addresses or deployment info (see `docs/DEPLOYMENTS.md`)
- ❌ Active roadmap (see `NEXT_STEPS.md`)

---

## What Changed Since design-v2

1. **VK Format:** Switched from Poseidon2 to Keccak oracle hash (zkVerify requirement)
2. **Attestation:** Proven working on Horizen testnet (not just Base Sepolia)
3. **Roadmap:** Moved from day-locked plan to phase-based approach
4. **CCN Features:** Agent accounts built but not priority; RWA support deferred

---

## Key Files Still Relevant

- **architecture_overview.md** - High-level system design ✅
- **subsystems/** - Detailed component specs ✅ (with caveats)
- **spikes/01_critical_path.md** - Critical path analysis ✅

## Files That Are Outdated

- **progress.md** - See `GROUND_TRUTH.md` instead
- **roadmap/** - See `NEXT_STEPS.md` instead

---

For current project status, always start with `GROUND_TRUTH.md`.
