## Summary — bb.js Downgrade Investigation Complete

We've completed the investigation into downgrading bb.js as the Horizen engineer advised. **Key finding: the issue is deeper than just bb.js version.**

### What We Discovered

**The problem is circuit bytecode compatibility, not just VK format:**

- bb.js 3.0.x generates 3680-byte VKs (incompatible with Kurier V3_0 which expects 1888 bytes)
- bb.js 2.x, 1.x, and 0.87.x **cannot parse Noir 1.0.0-beta.18 circuit bytecode** — WASM crashes with `RuntimeError: unreachable`
- This means downgrading bb.js also requires downgrading Noir and recompiling all 11 circuits

**Versions tested:**
- ✅ bb.js 3.0.x: works with circuits, produces 3680-byte VKs (too large)
- ❌ bb.js 2.1.0-rc.x: WASM crash on circuit load
- ❌ bb.js 1.2.x: WASM crash on circuit load  
- ❌ bb.js 0.87.x: WASM crash on circuit load
- ❌ bb.js 0.84.0: different API (pre-UltraHonk era)

### What We Need from Horizen

The engineer said "downgrade bb.js" but we need the exact version pair:

**Question for Michael "Clive" in Discord:**
> "We attempted to downgrade bb.js but discovered that all older versions (0.87.x, 1.x, 2.x) cannot parse Noir 1.0.0-beta.18 circuit bytecode — the WASM crashes with `RuntimeError: unreachable` when loading the circuit.
> 
> Can you provide the exact **bb.js + Noir version pair** that:
> 1. Generates 1888-byte UltraHonk VKs compatible with Kurier's V3_0 pallet
> 2. Supports the UltraHonk proving system
> 
> Or alternatively: what's the timeline for a V3_1 pallet that supports 3680-byte VKs from bb.js 3.0.x?"

### Recommended Path Forward

**Today:**
1. Post the question above in Discord
2. Share `BB_JS_DOWNGRADE_FINDINGS.md` for technical context

**In parallel (don't block on this):**
- Continue Phase 3 (Railway + Vercel hosting setup)
- Continue Phase 4 (UX redesign — position screen, guided flows)

**If no response in 48h:**
- Deploy with mock verifier for the Accelerator demo
- Can still show: shielded deposits, encrypted note storage, recovery-from-signature
- Cannot show: real zkVerify aggregation (but mock path proves the integration architecture)

### Documentation Created

- **`BB_JS_DOWNGRADE_FINDINGS.md`** — complete investigation report with test results
- **`.vktest/test-vk-backend-api.mjs`** — automated VK size testing script
- **`.vktest/test-1x-verbose.mjs`** — detailed error diagnostics

### Vela TEE Update

The good news from the Discord exchange: **Vela TEE proving is fully validated** ✅

Michael confirmed:
- Memory is NOT a problem (can scale to 64GB, our bb.js needs 400-800MB)
- Use native `barretenberg.wasm` directly (skip bb.js TypeScript wrapper)
- Vela runs Wasm-time, so direct WASM loading works
- "Their approach is completely feasible. They can go ahead and try it with confidence."

This means once the VK compatibility issue is resolved, we can immediately start Phase 0 of the Vela implementation (VELA_PROVING_INTEGRATION.md) with confidence.

---

**Next action:** Post Discord message to get exact version compatibility info, continue infrastructure work in parallel.
