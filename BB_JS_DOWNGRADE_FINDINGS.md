# bb.js Downgrade Investigation — 2026-08-18

## Problem Statement

Horizen DevRel engineer Michael "Clive" advised: "Right now Kurier only supports a fairly old version. bb.js is being updated very fast on their side, so if you want to use bb.js, **the only option for now is to downgrade**."

We attempted to find a bb.js version that:
1. Generates 1888-byte UltraHonk VKs (not 3680 bytes)
2. Works with Noir 1.0.0-beta.18 circuit artifacts
3. Supports UltraHonk proving system (not UltraPlonk)

## Versions Tested

### bb.js 3.x (current)
- **Versions tested**: 3.0.0-rc.6, 3.0.1, 3.0.2, 3.0.3
- **VK size**: 3680 bytes
- **Circuit compatibility**: ✅ Works with Noir 1.0.0-beta.18
- **Result**: ❌ Kurier V3_0 pallet expects exactly 1888 bytes
- **Error**: `Expected input with 1888 bytes (15104 bits), found 3680 bytes`

### bb.js 2.x
- **Versions tested**: 2.1.0-rc.16, 2.1.0-rc.10, 2.1.0-rc.5, 2.1.0-rc.1
- **VK size**: N/A (crashed before VK generation)
- **Circuit compatibility**: ❌ WASM crashes with `RuntimeError: unreachable`
- **Result**: Cannot parse Noir 1.0.0-beta.18 circuit bytecode

### bb.js 1.x
- **Versions tested**: 1.2.1, 1.2.0, 1.1.3, 1.1.2, 1.1.0
- **VK size**: N/A (crashed before VK generation)
- **Circuit compatibility**: ❌ WASM crashes with `RuntimeError: unreachable`
- **Result**: Cannot parse Noir 1.0.0-beta.18 circuit bytecode

### bb.js 0.87.x
- **Versions tested**: 0.87.9, 0.87.0
- **VK size**: N/A (crashed before VK generation)
- **Circuit compatibility**: ❌ WASM crashes with `RuntimeError: unreachable`
- **Result**: Cannot parse Noir 1.0.0-beta.18 circuit bytecode
- **Additional issue**: Missing peer dependency `msgpackr` (fixed by manual install, still crashes)

### bb.js 0.84.0
- **Versions tested**: 0.84.0
- **VK size**: N/A (different API)
- **Circuit compatibility**: Unknown
- **Result**: Different API (`circuitComputeVk` doesn't exist), likely UltraPlonk era

## Root Cause Analysis

The issue is **NOT just VK format** — it's **circuit bytecode compatibility**.

bb.js 3.0.x introduced a new circuit bytecode format that Noir 1.0.0-beta.18 uses. Older bb.js versions (0.x, 1.x, 2.x) cannot parse this bytecode — they crash with `RuntimeError: unreachable` inside the WASM when attempting to load the circuit.

**This means:**
- We cannot downgrade bb.js without also downgrading Noir
- Downgrading Noir means recompiling all 11 circuits with an older Noir version
- We must find which Noir version was compatible with which bb.js version that generates 1888-byte VKs

## The Missing Information

The Horizen engineer's advice to "downgrade bb.js" assumes we know:
1. **Which exact bb.js version** generates 1888-byte UltraHonk VKs?
2. **Which Noir version** is compatible with that bb.js version?
3. **When did the VK format change** from 1888 bytes to 3680 bytes in bb.js?

Without this information, we are searching blindly through a version space where:
- Circuit compatibility breaks (WASM crashes)
- API compatibility breaks (methods don't exist)
- Dependency compatibility breaks (missing msgpackr)

## Proposed Resolution Path

### Option A: Ask Horizen for Exact Version Numbers ✅ RECOMMENDED
**Contact Michael "Clive" in Discord with:**
> "We attempted to downgrade bb.js but discovered that bb.js 0.x/1.x/2.x cannot parse Noir 1.0.0-beta.18 circuit bytecode (WASM crashes with 'unreachable'). We tested versions 0.84.0, 0.87.9, 1.2.1, and 2.1.0-rc.16 — all fail.
> 
> Can you provide the exact bb.js + Noir version pair that:
> 1. Generates 1888-byte UltraHonk VKs compatible with Kurier's V3_0 pallet
> 2. Supports the UltraHonk proving system (not UltraPlonk)
> 
> Or alternatively: is there a V3_1 pallet version that supports 3680-byte VKs from bb.js 3.0.x?"

### Option B: Recompile Circuits with Older Noir
1. Find the Noir version that was contemporary with bb.js 0.84.0 (likely Noir 0.x)
2. Install that Noir version
3. Recompile all 11 circuits
4. Test if bb.js 0.84.0 generates 1888-byte VKs with those circuits
5. Update all witness generation code (TypeScript interfaces may have changed)
6. Risk: Older Noir may not support Poseidon2 or other features we rely on

### Option C: Wait for Kurier V3_1 Pallet
The engineer said: "I have asked the core zkVerify/Kurier team if this can be added to the roadmap to upgrade"

If Kurier adds support for 3680-byte VKs, no changes needed on our side.

**Risk**: Unknown timeline, blocks Phase 2 launch

### Option D: Use Mock Mode for Demo, Defer Real Proving
Deploy with mock verifier for the demo, continue development on other phases, revisit when Kurier is updated or we get exact version numbers.

**Trade-off**: Cannot show real zkVerify aggregation in the demo

## Recommendation

**Immediate**: Post Option A message in Discord today
**Parallel**: Continue with Phase 3 (hosting infrastructure) and Phase 4 (UX redesign) while waiting for response
**Fallback**: If no response in 48h, use Option D (mock mode) for Accelerator demo

## Test Artifacts

- Script: `.vktest/test-vk-backend-api.mjs` — tests VK size for any bb.js version
- Script: `.vktest/test-1x-verbose.mjs` — verbose error output
- Command: `node test-1x-verbose.mjs` with `@aztec/bb.js@<version>` installed

---

**Status**: Investigation complete, awaiting guidance from Horizen team on exact compatible version pair.
