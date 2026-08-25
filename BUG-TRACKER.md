# Bug Tracker & Resolution Log

This document tracks all bugs encountered during development, their root causes, attempted fixes, and final resolutions.

**Read this before debugging anything.** Several bugs here were diagnosed wrong
the first time and cost days; the corrections are recorded inline.

## Quick index — symptom → bug

| Symptom / error | Bug | One-line answer |
|---|---|---|
| `0x0868dfcf` on `getPrice` | #5, #9 | Oracle price stale. **Start the keeper** (`node scripts/price-keeper.mjs`) — window CANNOT be widened, it's a hardcoded constant |
| Refresh script succeeds but price still stale | #6 | Script has a hardcoded **old** oracle address |
| `0x79993b73` on `supplyAsset` | #8 | zkVerify publish race (**not** a balance issue — Bug #1 was wrong) |
| `Cannot satisfy constraint` | #7 | Submitted while the recovery scan was still running |
| `LocalIMT.proofFor: idx N out of range [0, 0)` | #2, #7 | Stale IndexedDB after redeploy, **or** tree not yet hydrated |
| `0xc5723b51` from Stork | #5 | Stork has no on-chain data on Horizen — offchain feeds only |
| `Failed to fetch` on any action | #4 | data-api isn't running |
| `AccessControlUnauthorizedAccount` | #5 | Missing `MANAGER_ROLE` — grant it to the caller |

## Standing gotchas (bit us more than once)

1. **A successful tx ≠ a working fix.** Verify resulting on-chain state, never
   the forge receipt. Bug #6 passed with green checkmarks against a dead contract.
2. **Decode signatures against our own source before calling them unknown.**
   See "Decoding an unknown signature" near the end of this file.
3. **After ANY redeploy:** `grep -rn "0x[0-9a-fA-F]\{40\}" code/contracts/script/`
   then update `.env.local`, data-api `.env`, and clear browser IndexedDB.
4. **Oracle prices expire hourly and the window CANNOT be widened**
   (`MAX_STALENESS_WINDOW` is a `constant` at `Oracle.sol:25`). Run the price
   keeper — it's a required service, not optional. See Bug #9.
5. **Long RPC URLs wrap in the terminal and silently drop trailing flags**
   (`--broadcast` got eaten twice). Use `--rpc-url horizen` — the alias is in
   `foundry.toml`.
6. **Wait for "Syncing…" to clear** in the dapp before submitting.

---

## Bug #1: Supply Flow Error - Contract Revert 0x79993b73

**Date**: 2026-08-22
**Severity**: High
**Status**: Resolved 2026-08-25 — see Bug #8 for the actual root cause

> **⚠️ The "Likely Root Cause" below (zero USDC balance) was WRONG.**
> On 2026-08-25 the signature was decoded properly: `0x79993b73` is
> `AggregationVerifyFailed()` from `ZkVerifier.sol:42`. It has nothing to do
> with token balances. The investigation recorded here is preserved because
> the config fixes it produced were independently necessary, but do not
> reuse its conclusion. **Read Bug #8 instead.**
>
> Lesson: the entry below says the signature "does not match any known custom
> errors in our contracts" and was "not found in 4byte.directory". Both were
> premature — the error was defined in our own `ZkVerifier.sol` the whole
> time. One `cast sig "AggregationVerifyFailed()"` would have found it on day
> one. **Always enumerate custom errors from source with `cast sig` before
> concluding a signature is unknown.** Bug #8 has the one-liner that does this.

### Symptoms
- User attempted to supply USDC via the dapp at http://localhost:3000
- Transaction reverted with error signature `0x79993b73`
- Error message: `ContractFunctionExecutionError: The contract function "supplyAsset" reverted`
- Full contract address: `0x3777b7E224d50075B809aAbDe9cF51e2D78542D1` (ShieldedSupplyPool)

### Initial Investigation
1. Error signature `0x79993b73` does not match any known custom errors in our contracts
2. Checked all contract custom errors - no matches found
3. Not found in 4byte.directory database

### Root Cause Analysis

#### Discovery Process
1. **Oracle Configuration**: Initially suspected oracle wasn't seeded
   - Verified oracle had prices: USDC = $1.00 (1e8), cbBTC = $60,000 (60000e8) ✅
   
2. **Asset Registration**: Checked if assets were registered in AssetRegistry
   - Confirmed 2 assets registered ✅
   
3. **Rate Model Initialization**: Verified rate models were initialized
   - USDC (asset 0): Initialized ✅
   - cbBTC (asset 1): Initialized ✅
   
4. **Deployment History**: Multiple overlapping deployments causing confusion
   - v1.2 deployment with correct admin but different addresses
   - v1.3 deployment with wrong admin address
   - User was confused about which deployment was active
   
5. **User Wallet Balance**: Discovered user had 0 USDC
   - This was likely causing the revert ✅ **KEY FINDING**
   
6. **USDC Allowance**: User had 0 allowance for ShieldedSupplyPool
   - Dapp should prompt for approval before supply transaction

### Attempted Fixes

#### Fix #1: Fresh Deployment with Correct Admin
**Action**: Redeployed all contracts with user's wallet as admin
- Deployed contracts to Horizen testnet (chain 2651420)
- Admin address: `0x4c2923d698a79dd85E900BCD9fDDb3Ef4973041e`
- Deployment block: 25940336

**New Contract Addresses (v2.0)**:
- Oracle: `0x128cB52bE500871bcBFBeCfb28E53fa89AbB14B5`
- RateModel: `0xB795a9818b6521D76627271C19fAd4deb9dA79F2`
- AssetRegistry: `0xb22be584174782931Da2F077Bf5ed806a2D74230`
- ShieldedSupplyPool: `0x3777b7E224d50075B809aAbDe9cF51e2D78542D1`
- PrivacyEntry: `0xe9CF971C2AfDCCD6C69eE6E970b14fAAb2DC7ab2`
- ZkVerifier: `0x0c372Ce29827B970F79BACf3a962e4b6BC52899b`
- Mock USDC: `0x89Ed5f01A38E9c911bbF12FdB0e9588C5c15C632`

**Result**: Contracts deployed successfully ✅

#### Fix #2: Oracle Seeding
**Action**: Ran `SeedOracleV2_0.s.sol` script to seed oracle prices
- USDC (asset 0): $1.00 (1e8)
- cbBTC (asset 1): $60,000 (60000e8)

**Result**: Oracle seeded successfully ✅

#### Fix #3: Update Data-API Configuration
**Action**: Updated `code/backend/data-api/.env` with v2.0 contract addresses
- Changed all contract addresses from v1.2 to v2.0
- Updated deployment block to 25940336
- Restarted data-api

**Result**: Data-API running with new config ✅

#### Fix #4: Update Dapp Configuration
**Action**: Updated `code/dapp/.env.local` with v2.0 contract addresses
- Updated all `NEXT_PUBLIC_HORIZEN_*` variables
- Updated deployment block to 25940336
- Updated admin panel hardcoded addresses in `src/app/admin/page.tsx`
- Restarted dapp (killed PID 17220, npm run dev)

**Result**: Dapp running with new config ✅

#### Fix #5: Archive Old Deployments
**Action**: Moved old deployment files to prevent confusion
- Moved `horizen-testnet-2651420-v1.2.json` to `archive/`
- Moved `horizen-testnet-2651420-v1.3.json` to `archive/`
- Main file `horizen-testnet-2651420.json` now contains v2.0 deployment

**Result**: Old deployments archived ✅

#### Fix #6: Grant MANAGER_ROLE to Relayer
**Action**: Created and ran `SetupV2_0.s.sol` script
- Granted Oracle MANAGER_ROLE to relayer (`0xB19f1F29DdC0C5248DE5bA98dDa4f94f9a562707`)
- Granted RateModel MANAGER_ROLE to relayer
- Verified oracle prices are set
- Verified rate models are initialized

**Result**: Roles granted successfully ✅

#### Fix #7: Mint Test USDC
**Action**: Minted 1000 USDC (1000000000 with 6 decimals) to user's wallet
- User wallet: `0x4c2923d698a79dd85E900BCD9fDDb3Ef4973041e`
- Mock USDC contract: `0x89Ed5f01A38E9c911bbF12FdB0e9588C5c15C632`
- Command: `cast send [mint function]`

**Result**: 1000 USDC minted successfully ✅

### Current Status
**PENDING USER VERIFICATION**: Waiting for user to:
1. Hard refresh dapp (Ctrl+F5)
2. Verify admin panel shows correct wallet
3. Attempt supply operation again

### Likely Root Cause
The error `0x79993b73` was likely caused by:
1. **Zero USDC balance** - attempting to supply 0 tokens or transfer from empty balance
2. Possibly combined with **stale dapp cache** using old contract addresses

### Resolution
- **Fixed**: User now has 1000 USDC
- **Fixed**: All contracts properly configured and initialized
- **Fixed**: Relayer has necessary roles
- **Pending**: User needs to refresh dapp and retry

### Prevention
1. **Always check user token balance before debugging contract calls**
2. **Ensure dapp is hard-refreshed after .env changes**
3. **Verify allowances before supply/borrow operations**
4. **Keep single source of truth for deployment addresses**
5. **Archive old deployments immediately after new ones**

### Next Steps if Still Failing
1. Check browser console for frontend errors
2. Verify dapp is actually using new contract addresses (check network tab)
3. Check if approval transaction is being sent before supply
4. Enable verbose logging in data-api to see full transaction flow
5. Try supply operation with small amount (e.g., 1 USDC) first

### Files Modified
- `code/contracts/deployments/horizen-testnet-2651420.json` - Updated to v2.0
- `code/backend/data-api/.env` - Updated contract addresses
- `code/dapp/.env.local` - Updated contract addresses
- `code/dapp/src/app/admin/page.tsx` - Updated hardcoded addresses
- `code/contracts/script/SeedOracleV2_0.s.sol` - Created
- `code/contracts/script/SetupV2_0.s.sol` - Created
- `code/contracts/.env` - Created with deployer private key

### Commands Used
```bash
# Deployment
forge script script/DeployHorizenTestnet.s.sol --rpc-url https://horizen-testnet.rpc.caldera.xyz/http --broadcast --legacy

# Oracle seeding
forge script script/SeedOracleV2_0.s.sol --rpc-url https://horizen-testnet.rpc.caldera.xyz/http --broadcast --legacy

# Setup (grant roles)
forge script script/SetupV2_0.s.sol --rpc-url https://horizen-testnet.rpc.caldera.xyz/http --broadcast --legacy

# Mint USDC
cast send 0x89Ed5f01A38E9c911bbF12FdB0e9588C5c15C632 "mint(address,uint256)" 0x4c2923d698a79dd85E900BCD9fDDb3Ef4973041e 1000000000 --rpc-url https://horizen-testnet.rpc.caldera.xyz/http --private-key 0x... --legacy

# Verification commands
cast call [contract] [function] --rpc-url https://horizen-testnet.rpc.caldera.xyz/http
```

---

## Bug #2: LocalIMT.proofFor Index Out of Range on Supply

**Date**: 2026-08-22
**Severity**: Critical
**Status**: Resolved 2026-08-25 (root cause below was correct; a second
trigger for the same error was found later — see Bug #7)

> The root-cause analysis below (stale IndexedDB notes pointing at leaves that
> don't exist in a fresh deployment) is **correct** and clearing storage does
> fix it. Confirmed again after the V3 deploy on 2026-08-24.
>
> But there is a **second, independent** way to produce an out-of-range or
> mismatched-tree error: submitting while the recovery scan is still running,
> so the tree is only partly hydrated. Storage clearing does not help there —
> waiting does. That is Bug #7, and it now has a code fix.

### Symptoms
- User attempted to supply USDC via the dapp
- Error: `LocalIMT.proofFor: idx 1 out of range [0, 0)`
- This is a **client-side error** from the TypeScript IMT implementation
- Error occurs in `code/dapp/src/lib/imt.ts:149`

### Root Cause Analysis

#### What the Error Means
- The code is trying to get a Merkle proof for leaf at index `1`
- But the local `supplyImt` tree only has `0` leaves (empty tree: range `[0, 0)`)
- The IMT (Incremental Merkle Tree) needs to mirror the on-chain tree state

#### Why It Happens - **IDENTIFIED ROOT CAUSE**
1. **Stale Browser Storage**: Browser has encrypted notes from v1.2/v1.3 deployments stored in IndexedDB
2. **Note Vault Loads Old Data**: When unlocking, `NoteVault.loadAll()` loads old supply notes from IndexedDB
3. **Old Notes Reference Non-Existent Commitments**: These notes reference commitments from v1.2/v1.3 that don't exist in v2.0
4. **Supply Flow Uses Stale Note**: The supply form tries to spend/update an old note, asking for `proofFor(1)` 
5. **Empty Tree on v2.0**: But v2.0 has a fresh, empty supply tree with no leaves

#### Evidence
- Multiple deployments occurred (v1.2, v1.3, v2.0) with different contract addresses
- No deployment block validation to auto-clear storage when contracts change
- IndexedDB vault key is based on `chainId + address`, not deployment version
- Same chainId (2651420) means same vault across all three deployments

#### Key Code Location
`code/dapp/src/hooks/useSpendingKey.tsx:186-194`:
```typescript
// 2) Hydrate IMTs from recovered leaves
const sortedDeposits = [...view.depositLeaves].sort((a, b) => a.leafIndex - b.leafIndex);
for (const { commitment } of sortedDeposits) {
  entryImtRef.current.insert(BigInt(commitment));  // Only entryImt is hydrated!
}
// supplyImtRef and positionImtRef are never hydrated!
```

### Why This Wasn't Caught Before
- This is a **fresh deployment** (v2.0) with no previous supply history
- On a fresh deployment, the first supply should work (index 0)
- But the code is trying to access index 1, suggesting it thinks there's already a supply note
- OR the recovery scan found a deposit that it's treating as a supply

### Attempted Fixes

#### Fix #1: Clear Browser Storage - UPDATED INSTRUCTIONS
**Action**: More thorough storage clearing process
**Commands**:
```javascript
// Method 1: Via Console (UPDATED - more thorough)
// 1. First, list all IndexedDB databases
indexedDB.databases().then(dbs => {
  console.log('Databases:', dbs);
  dbs.forEach(db => {
    console.log('Deleting:', db.name);
    indexedDB.deleteDatabase(db.name);
  });
});

// 2. Clear localStorage
localStorage.clear();

// 3. Clear sessionStorage
sessionStorage.clear();

// 4. Then reload
setTimeout(() => location.reload(), 1000);
```

**Method 2: Manual via DevTools (MORE RELIABLE)**:
1. Open DevTools (F12)
2. Go to **Application** tab
3. In left sidebar, expand **Storage**
4. Expand **IndexedDB** - manually delete each database
5. Click **Local Storage** → `http://localhost:3000` → Right-click → Clear
6. Click **Session Storage** → `http://localhost:3000` → Right-click → Clear
7. Click **Clear site data** button at top
8. Close and reopen browser
9. Go to http://localhost:3000

**Status**: User tried console method, but data persists - need to try manual method

#### Fix #2: Add Deployment Version to Vault Key (PROPER FIX)
**Action**: Change vault storage key to include deployment block or contract address
**Location**: `code/dapp/src/lib/note-vault.ts`
**Current Key**: `zenfinance:vault:${chainId}:${address}`
**Proposed Key**: `zenfinance:vault:${chainId}:${address}:${deploymentBlock}`
**Benefit**: Auto-isolates notes across deployments
**Status**: Not implemented yet

#### Fix #3: Validate Deployment on Unlock
**Action**: Add deployment block check when unlocking - clear vault if mismatch
**Logic**: 
```typescript
const configDeployBlock = getChainConfig(chainId).deploymentBlock;
const vaultDeployBlock = await vault.getMetadata('deploymentBlock');
if (vaultDeployBlock && vaultDeployBlock !== configDeployBlock) {
  await vault.clear(); // New deployment, clear old notes
  await vault.setMetadata('deploymentBlock', configDeployBlock);
}
```
**Status**: Not implemented yet

### Current Status
**IDENTIFIED ROOT CAUSE**: Stale browser storage from v1.2/v1.3 deployments
**IMMEDIATE FIX ATTEMPTED**: User cleared browser storage ❌ **DID NOT FULLY WORK**

**UPDATE**: User cleared storage but still getting same error
**NEW FINDING**: Console shows `oldBalance` with `leafIdx: 1` - stale note still in note store
- Storage clear command didn't remove the encrypted vault completely
- OR the vault was re-populated from somewhere else
- Need to check if IndexedDB was actually cleared

### Resolution Path
**Current Issue**: IndexedDB vault not properly cleared
**Need to**: 
1. Manually inspect IndexedDB in DevTools
2. Delete all databases manually if still present
3. Possibly need to sign out and clear spending key

### Next Steps
1. **Immediate**: User clears browser storage and tests supply again
2. **Short-term**: Implement deployment block in vault storage key
3. **Medium-term**: Add auto-migration logic to detect and clear stale vaults
4. **Long-term**: Add UI button to "Reset wallet" that clears all local storage

### Files to Modify for Permanent Fix
- `code/dapp/src/lib/note-vault.ts` - Add deployment block to storage key
- `code/dapp/src/hooks/useSpendingKey.tsx` - Add deployment validation on unlock
- `code/dapp/src/components/SettingsPanel.tsx` - Add "Clear Storage" button (if exists)

### Related Bugs
- Related to Bug #1 (deployment confusion with multiple versions)
- May be caused by stale browser state from v1.2/v1.3 deployments

### Prevention
1. **Hydrate all IMTs**: Recovery scanner should hydrate entry, supply, AND position IMTs
2. **Clear state on new deployment**: Detect deployment block change and clear local storage
3. **Better error messages**: Include actual vs expected tree size in error
4. **Validate tree state**: Check IMT is properly hydrated before attempting operations

---

## Bug #3: Cannot Read Properties of Undefined (reading 'text')

**Date**: 2026-08-22  
**Severity**: High  
**Status**: In Progress

### Symptoms
- User cleared browser storage as instructed for Bug #2
- Attempted to supply USDC
- Error: `Cannot read properties of undefined (reading 'text')`
- This is a **JavaScript runtime error**, likely in the frontend

### Root Cause Analysis

#### What the Error Means
- Code is trying to access `.text` property on an `undefined` object
- Common causes:
  1. API response is undefined
  2. Missing data-api response
  3. Circuit artifact file not found
  4. Proof generation failed silently

#### Investigation Needed
- Need to see browser console for full stack trace
- Need to check which component is throwing this error
- Likely related to proof generation or API calls

### Attempted Fixes

#### Investigation #1: Get Full Error Stack Trace
**Action**: Need user to provide full error from browser console (F12 → Console)
**Status**: PENDING ⏳

#### Investigation #2: Check Data-API Logs
**Action**: Check if data-api is receiving the request and responding correctly
**Status**: Not checked yet

#### Investigation #3: Check Circuit Artifacts
**Action**: Verify circuit artifacts are properly copied to public directory
**Status**: Not checked yet

### Current Status
**WAITING FOR**: Full error stack trace from browser console

### Next Steps
1. Get complete error message with stack trace
2. Identify which component/function is failing
3. Check if data-api is running and responding
4. Verify circuit artifacts are accessible

### Related Bugs
- Follow-up to Bug #2 (appeared after clearing storage)

---

## Bug #4: Deposit Failed - "Failed to fetch" (Data-API Not Running)

**Date**: 2026-08-24  
**Severity**: High  
**Status**: Resolved

### Symptoms
- User attempted to deposit USDC via the dapp at http://localhost:3000
- Error displayed: "Deposit failed. Failed to fetch"
- No additional context or stack trace visible to user
- Browser console shows: `TypeError: Failed to fetch`

### Root Cause Analysis

#### What the Error Means
- `Failed to fetch` is a browser-level network error, not a contract revert
- Occurs when `fetch()` cannot establish a connection to the target endpoint
- In this case: `DepositForm.tsx:39` configures `API_BASE = http://127.0.0.1:8787`
- The deposit flow calls `sdk.intents.create()` → `POST http://127.0.0.1:8787/v1/intents`

#### Root Cause
**The data-api server was not running.** Nothing was listening on port 8787.

Evidence:
```bash
netstat -ano | grep LISTENING | grep ":8787"
# (empty result before fix)
```

Only port 3000 (the Next.js dapp) was listening. When the browser tried to POST to 8787, it got connection-refused, which `fetch()` reports as `Failed to fetch`.

#### Why It Wasn't Obvious
1. **No port check at dapp startup** - The dapp doesn't verify the API is reachable before allowing deposits
2. **Generic error message** - `DepositForm.tsx:254` renders `err.message` verbatim with no network-specific handling
3. **Silent API startup** - `LOG_LEVEL=warn` in `.env` means no "listening on 8787" confirmation
4. **Slow tsx compilation** - Takes ~40s to bind the port, easy to assume it's running when it's not

### Attempted Fixes

#### Fix #1: Start the Data-API Server
**Action**: Started the data-api process
```bash
cd code/backend/data-api
npm start
```

**Verification**:
```bash
# After ~40s compilation:
netstat -ano | grep LISTENING | grep ":8787"
# TCP    127.0.0.1:8787         0.0.0.0:0              LISTENING       9008

curl http://127.0.0.1:8787/v1/health
# {"status":"ok","version":"0.2.0","day":11}

# Test real deposit intent:
curl -X POST http://127.0.0.1:8787/v1/intents \
  -H "Origin: http://localhost:3000" \
  -H "content-type: application/json" \
  -H "x-api-key: <redacted>" \
  -d '{"kind":"entry_deposit","asset":"USDC","amount":"1000000","commitment":"0x111...","encryptedMemo":"0xdeadbeef"}'
# HTTP 202 {"intent_id":"22ffd3bc...","status":"received"}

# Verify intent processing:
curl http://127.0.0.1:8787/v1/intents/22ffd3bc-07dc-427e-88bc-a8e3b1b6f34f \
  -H "x-api-key: <redacted>"
# {"intent_id":"22ffd3bc...","status":"proving",...}
```

**Result**: ✅ **SUCCESS** - Full deposit pipeline working (received → proving → relayer pickup)

### Final Resolution

**Fixed**: Started the data-api server. User can now deposit successfully.

**Startup command**:
```bash
cd code/backend/data-api && npm start
```

- Wait ~40s for `tsx` compilation to complete
- Verify with `curl http://127.0.0.1:8787/v1/health` (should return 200 OK)
- Postgres must be running on 5432 (was already running)

### Secondary Issue Discovered (Not Blocking)

**CORS origin mismatch**: The API's `CORS_ORIGINS` allowlist contains only `http://localhost:3000`.

If the user accesses the dapp via `http://127.0.0.1:3000` instead, the browser sends a different `Origin` header that fails the CORS preflight check:

```bash
# From localhost:3000 → works
curl -X OPTIONS http://127.0.0.1:8787/v1/intents \
  -H "Origin: http://localhost:3000"
# HTTP 204 + access-control-allow-origin: http://localhost:3000

# From 127.0.0.1:3000 → blocked
curl -X OPTIONS http://127.0.0.1:8787/v1/intents \
  -H "Origin: http://127.0.0.1:3000"
# HTTP 401, no access-control-allow-origin header
```

This produces the **identical** `Failed to fetch` error with a healthy API.

**Workaround**: Always use `http://localhost:3000` to access the dapp.

**Permanent fix** (optional): Add `http://127.0.0.1:3000` to `CORS_ORIGINS` in `code/backend/data-api/.env`:
```bash
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

### Prevention

1. **Add port health check on dapp load** - Ping `/v1/health` on mount, show banner if unreachable
2. **Better error messages** - Detect `Failed to fetch` in `DepositForm.tsx` catch block:
   ```typescript
   catch (err) {
     const reason = err instanceof Error ? err.message : String(err);
     if (reason === 'Failed to fetch') {
       setState({
         phase: "failed",
         reason: `Cannot reach the API at ${API_BASE}. Is the data-api running? Start it with: cd code/backend/data-api && npm start`
       });
     } else {
       setState({ phase: "failed", reason });
     }
   }
   ```
3. **Startup script** - Create `dev.sh` that starts both dapp and data-api together:
   ```bash
   #!/bin/bash
   cd code/backend/data-api && npm start &
   cd code/dapp && npm run dev &
   wait
   ```
4. **Document the startup order** - Add to README: "Start data-api first, wait for health check, then start dapp"
5. **Add LOG_LEVEL=info for dev** - Show "listening on 8787" confirmation

### Related Bugs
- Related to Bug #1 (contract configuration issues) - both caused by missing startup steps
- Related to Bug #3 (undefined `.text` error) - appeared after clearing storage, but root cause was data-api being down

### Notes
- Configuration was correct: `.env` matched canonical v2.0 deployment addresses
- API keys matched across `data-api/.env` and `dapp/.env.local` (verified by hash)
- Postgres was running on 5432 throughout
- `.env.horizen` contains stale addresses but is not loaded by `config.ts` (uses bare `loadEnv()` which reads `.env`)

---

## Bug #5: Oracle PriceStale (0x0868dfcf) — the recurring one

**Date**: 2026-08-24, recurred 3+ times through 2026-08-25
**Severity**: High (blocks every supply/borrow)
**Status**: Mitigated, NOT fixed — see "Permanent fix" below

### Symptoms
```
The contract function "getPrice" reverted with signature 0x0868dfcf
Contract: 0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2  (V3 Oracle)
function: getPrice(uint8 assetId) args: (0)
```

### What was blocked
Every supply and borrow. `ShieldedSupplyPool.supplyAsset` →
`rateModel.accrue()` → oracle read. No price, no operation.

### Decoding it (do this first, always)
`0x0868dfcf` = `PriceStale(uint8 assetId, uint64 updatedAt, uint64 nowTs, uint32 window)`.
Unlike most reverts this one **carries its own diagnosis** in the return data:

```bash
# Grab the full revert payload
cast call <ORACLE> "getPrice(uint8)(uint128)" 0 --rpc-url horizen 2>&1

# Decode the 4 params (strip the 0x + 8-char selector first)
node -e "
const p='<PAYLOAD_WITHOUT_0x0868dfcf>';
const u=parseInt(p.slice(64,128),16), n=parseInt(p.slice(128,192),16), w=parseInt(p.slice(192,256),16);
console.log('last push:', new Date(u*1000).toISOString());
console.log('chain now:', new Date(n*1000).toISOString());
console.log('window   :', w, 'sec');
console.log('age      :', Math.round((n-u)/60), 'min | stale by', Math.round((n-u-w)/60), 'min');
"
```
`updatedAt` tells you whether the price was **never pushed to this oracle**
(hours/days old) or **just expired** (slightly over the window). Those are
different bugs with different fixes — decode before acting.

### Root cause
`Oracle.setStalenessWindow` is **3600s (1 hour)** and prices are pushed
manually. Any idle hour breaks the app. There is no keeper.

Compounding factor: Stork was expected to supply prices automatically, but
**Stork's Horizen agreement covers offchain feeds only** (confirmed by their
team 2026-08-25). Their on-chain contract at
`0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62` has **no data** for our feed IDs
— it reverts `0xc5723b51`. So the Stork path is inert and we fall back to
manual pushes. See Bug #6.

### Mitigation (what we actually do)
```bash
cd code/contracts
forge script script/RefreshOraclePrices.s.sol --rpc-url horizen --broadcast --legacy
```
Buys 1 hour. Verify after:
```bash
cast call <ORACLE> "getPrice(uint8)(uint128)" 0 --rpc-url horizen   # want 100000000
cast call <ORACLE> "getPrice(uint8)(uint128)" 1 --rpc-url horizen   # want 6000000000000
```

### Permanent fix — NOT YET DONE
Pick one before calling this production:
1. **Widen the window** — one `setStalenessWindow` call, ~2 min. Unblocks the
   week. Weakens the staleness guarantee, which is acceptable on testnet only.
2. **Stork Chain Pusher** — the real fix, matches Stork's guidance:
   https://docs.stork.network/getting-started/putting-data-on-chain
   Needs the API key already in hand. ~half a day.
3. **Keeper cron** — `*/30 * * * *` running the refresh script. Works, but
   adds infra to babysit and a hot private key.

### Prevention
- **Refresh prices before any demo or test session.** Assume they are stale
  after any gap.
- A "PriceStale" report is only interesting after decoding `updatedAt` — the
  interesting question is always *which* oracle went stale and how long ago.

---

## Bug #6: pushPrice / refresh hitting the WRONG Oracle after redeploy

**Date**: 2026-08-25
**Severity**: High — burns time, looks like the fix "didn't work"
**Status**: Resolved

### Symptoms
`RefreshOraclePrices.s.sol` reported full success — `ONCHAIN EXECUTION
COMPLETE & SUCCESSFUL`, two green `pushPrice` txs, real gas paid — and the
dapp **still** threw `PriceStale`. Ran it repeatedly with the same result.

### What was blocked
All supply/borrow, while appearing to have been fixed. The misleading success
output is what makes this expensive.

### Root cause
The oracle address was **hardcoded** in the script:
```solidity
address oracleAddr = 0x128cB52bE500871bcBFBeCfb28E53fa89AbB14B5;  // v2 Oracle!
```
After the V3 redeploy the live oracle was
`0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2`. The script was faithfully
refreshing a **dead contract**. Every tx genuinely succeeded — against the
wrong address.

### How it was caught
Decoding `PriceStale`'s `updatedAt` (Bug #5) showed the last push to the V3
oracle was **13 hours** old, while the script had "just succeeded" seconds
ago. A successful write and an ancient `updatedAt` on the same contract is
impossible — so the write must have gone somewhere else.

### Fix
`code/contracts/script/RefreshOraclePrices.s.sol` and
`FixOracleForTestnet.s.sol` now point at the V3 oracle with an explicit
trailing comment.

### Prevention — this class of bug will recur on every redeploy
1. **After ANY redeploy, grep every script for hardcoded addresses:**
   ```bash
   grep -rn "0x[0-9a-fA-F]\{40\}" code/contracts/script/
   ```
2. Scripts should read from `deployments/horizen-testnet-2651420.json`, not
   hardcode. (Not done yet — worth doing.)
3. **A successful tx is not a working fix.** Always verify the resulting
   on-chain state, not the tx receipt. `getPrice` returning a number is proof;
   `[Success]` in forge output is not.

---

## Bug #7: "Cannot satisfy constraint" — proving against a half-synced tree

**Date**: 2026-08-25
**Severity**: Critical
**Status**: Fixed in code (fix not yet confirmed end-to-end)

### Symptoms
```
Cannot satisfy constraint
```
Bare Noir error during "Generating proof", no file or line. Sometimes appeared
instead as `LocalIMT.proofFor: idx 0 out of range [0, 0)`.

### What was blocked
Supply. Failed before any transaction was sent — pure client-side.

### Root cause
`supply_asset/src/main.nr:65` asserts:
```noir
let computed_root = merkle_root(old_balance_commit, balance_siblings, balance_index_bits);
assert(computed_root == root_balance);
```
`LendingForm.tsx:411-412` builds both sides from the **local** IMT:
```ts
const balanceInsert = p.entryImt.proofFor(oldBalance.leafIdx);
const rootBalance   = p.entryImt.currentRoot();
```
If the local tree isn't fully hydrated from chain, that root doesn't match
what the contract has, and the assert fails. The recovery scan runs in the
background after unlock and takes ~30s+ on Horizen (chunked `eth_getLogs`
over millions of blocks) — but **nothing stopped the user submitting during
it**.

### Verified, not assumed
Replayed all 5 on-chain leaves through `LocalIMT` offline:
```
Local root: 1e22495883f14e194fb86bfa790088c7dcdfddba575928aecd413aa0ed6e2188
On-chain  : 1e22495883f14e194fb86bfa790088c7dcdfddba575928aecd413aa0ed6e2188  ✅
```
So the IMT implementation and the scanner are **correct**. The bug was purely
one of timing. This ruled out a much scarier hypothesis (Poseidon2 mismatch
between Noir and Solidity).

Useful detail: the tree must contain **every** leaf from **every** user, not
just yours — including junk like the `0x1111...1111` test deposit. A tree with
only your notes will not reproduce the root.

### Fix
`code/dapp/src/components/LendingForm.tsx` — pull `recovery` from
`useSpendingKey()`, derive `isScanning`, and gate the submit button:
```tsx
const isScanning = recovery.status === "scanning";
// ...
disabled={isBusy || isScanning || !amount}
{isScanning ? "Syncing…" : isProving ? "Proving…" : ...}
```

### Prevention
- **Wait for the button to stop saying "Syncing…"** before any operation.
- Any other form that proves against a tree (borrow, repay, withdraw,
  liquidate) needs the same guard. **Only the supply/lending form was fixed** —
  the others are still exposed.
- When a Noir assert fails, find the specific `assert` in the circuit and check
  each input independently. The circuit is almost never wrong; the witness is.

---

## Bug #8: AggregationVerifyFailed (0x79993b73) — zkVerify publish race

**Date**: 2026-08-22, correctly diagnosed 2026-08-25
**Severity**: Critical
**Status**: Fixed in code (fix not yet confirmed end-to-end)
**Supersedes**: Bug #1's incorrect "zero USDC balance" conclusion

### Symptoms
```
The contract function "supplyAsset" reverted with signature 0x79993b73
Contract: 0xd3900432F473f9367DC837d403Dd04D3Dd629db0  (ShieldedSupplyPool)
```
Failed at ~60% of "Aggregating with zkVerify", **after** the proof generated
and Kurier reported success.

The error text was often truncated mid-word (`bytes32 balanceNullifier, by`)
— that's data-api's `failure_reason` column capping at 500 chars
(`verify-and-call.ts:171`). **Truncation like that means the failure happened
server-side in data-api, not in the browser.** Useful signal.

### What was blocked
Every supply that got as far as aggregation. Worst kind of failure — minutes
of proving and aggregation spent before it dies.

### Decoding the signature (the step that was skipped for 3 days)
```bash
cast sig "AggregationVerifyFailed()"     # -> 0x79993b73
```
To enumerate every custom error in a contract at once:
```bash
grep -oE "error [A-Za-z]+\([^)]*\)" src/ZkVerifier.sol \
  | sed 's/error //' \
  | while read e; do echo "$(cast sig "$e")  $e"; done
```
Note `cast sig` needs the **type-only** form — `cast sig "PriceStale(uint8,uint64,uint64,uint32)"`,
not the version with parameter names. Passing named params fails to parse,
which is what made these signatures look "unknown" in Bug #1.

### Root cause
`ZkVerifier.sol:84-92` — the revert comes from the **proxy**, not our code:
```solidity
bool ok = proxy.verifyProofAggregation(
    proof.domainId, proof.aggregationId, proof.leaf,
    proof.merklePath, proof.leafCount, proof.leafIndex
);
if (!ok) revert AggregationVerifyFailed();
```
`verify-and-call.ts` submitted the tx **the instant Kurier said `Aggregated`**.
On Horizen, `Aggregated` means *zkVerify aggregated the proof* — **not** that
the aggregation root has been published to Horizen's proxy. Submitting into
that window = proxy returns false = revert.

Why this was missed: `prover-service/src/kurier/schemas.ts:88-90` says
> "On Base Sepolia the relayer pushes during Aggregated; the proxy already
> accepts the proof."

Verified on **Base Sepolia**. Horizen's publish lags. A correct observation
about one chain, silently carried to another.

### What was ruled out (all verified on-chain, don't re-check these)
| Hypothesis | Verdict | Evidence |
|---|---|---|
| Wrong domain ID | ❌ correct | proxy event topic `0xaf` = 175, matches `ZK_DOMAIN_ID` |
| Aggregations not reaching Horizen | ❌ they are | latest aggId `0x4aa` = 1194 |
| VK hash mismatch | ❌ passes | would revert `VkHashMismatch` `0x1a9f1d97` first |
| Replay / already consumed | ❌ passes | would revert `AlreadyConsumed` first |
| Zero USDC balance (Bug #1) | ❌ irrelevant | error is a Merkle check, not a transfer |
| Stale circuit artifacts | ❌ fine | `copy-circuits: 11 up-to-date` |

Because the VK and replay checks sit **before** the proxy call and both
passed, the proxy genuinely returned `false`. That narrowed it to timing.

### Fix
`code/backend/data-api/src/chain/zk-verifier.ts` — added
`AGGREGATION_PROXY_ABI` and a `proxy()` getter entry.

`code/backend/data-api/src/intent/handlers/verify-and-call.ts` — added
`waitForAggregationOnChain()`, which dry-runs the proxy's
`verifyProofAggregation` (a `view` call, so free) every 5s for up to 3 min
until it returns true. Design points that matter:
- Runs **outside `withChainLock`** — it can block for minutes, and holding the
  chain mutex would serialise every other intent behind it.
- **Does not throw on timeout.** Proceeds with the tx anyway, so an unobserved
  publish degrades to the old behaviour rather than turning a would-be success
  into a hard failure.
- Reads the proxy address from ZkVerifier's `proxy()` getter — no new env var
  to drift out of sync.

### Prevention
- **Decode every unknown signature against our own contracts before calling it
  unknown.** Three days were lost to this. Use the `grep | cast sig` loop above.
- **Timing assumptions are per-chain.** Anything verified on Base Sepolia must
  be re-verified on Horizen before being relied on.
- Prefer dry-running a `view` before spending gas on any call whose success
  depends on external state landing.
- When a revert comes from a called contract, check the **caller's** ordering
  of guards — which checks passed already is as informative as the failure.
- All 9 intent handlers (supply, borrow, repay, withdraw_supply,
  deposit_collateral, withdraw_collateral, liquidate, entry_withdraw) route
  through the same `verifyAndCall`, so **all of them inherit this fix**.

### Where to look if it recurs
1. Is the gate running at all? It's behind `ATTESTATION_MODE === "kurier"`.
2. Did it time out? Bump `PROXY_WAIT_TIMEOUT_MS` (currently 180s).
3. Is the domain ID still 175? Check the proxy's event `topic[1]`.
4. Did the leaf change? A mismatched `leaf` also returns false — compare
   `receiptToTuple` output against what Kurier actually returned.

---

## Bug #9: Borrow blocked by PriceStale — permanent fix via keeper

**Date**: 2026-08-25 (MVP launch day)
**Severity**: Critical — blocked borrow, the last unverified flow
**Status**: Resolved

### Symptoms
Deposit, supply, withdraw-supply, deposit-collateral and withdraw-collateral
all worked. **Borrow** failed with `getPrice` reverting `0x0868dfcf`
(`PriceStale`) — the same recurring issue as Bug #5, hit for the 4th time.

### What was blocked
Borrow specifically, but in truth every price-dependent operation on any
gap longer than an hour. Not viable to launch on.

### Why the obvious fix was impossible
The instinct is to widen the staleness window. **You cannot:**
```solidity
// Oracle.sol:25
uint32 public constant MAX_STALENESS_WINDOW = 3_600;
// Oracle.sol:92  (setStalenessWindow)
if (windowSeconds == 0 || windowSeconds > MAX_STALENESS_WINDOW) {
    revert InvalidWindow(windowSeconds);
}
```
`MAX_STALENESS_WINDOW` is a `constant`, so raising it needs a **new Oracle
deployment** plus AssetRegistry rewiring and config updates across dapp and
data-api — which would have invalidated the five flows already verified
working. Wrong trade on launch day.

**Check this constant before ever promising a wider window again.**

### Fix — price keeper
`code/backend/data-api/scripts/price-keeper.mjs`. Pushes both prices every
20 min (3x margin inside the 1h window, so two consecutive failures still
don't strand the protocol).

```bash
# One-time per Oracle deployment: let the relayer push prices
cd code/contracts
forge script script/GrantOracleManagerToRelayer.s.sol --rpc-url horizen --broadcast --legacy

# Then, leave running
cd code/backend/data-api
node scripts/price-keeper.mjs           # forever, every 20 min
node scripts/price-keeper.mjs --once    # single push, replaces the forge script
```

Runs on `RELAYER_PRIVATE_KEY` (already in data-api `.env`), so the deployer
key stays offline. `GrantOracleManagerToRelayer.s.sol` grants the relayer
`MANAGER_ROLE`; it's idempotent and safe to re-run.

### Two bugs found IN THE KEEPER on first run — both instructive
First run reported `only 0/2 pushed`, yet `getPrice(0)` returned a fresh
price on-chain. The push had **worked**; the script was lying.

1. **Receipt wait timed out on a tx that succeeded.** Horizen's confirmation
   reporting lags past viem's default receipt timeout. Treating a timeout as
   failure is wrong.
2. **Nonce collision.** With sequential `writeContract` +
   `waitForTransactionReceipt`, the timed-out first tx left viem deriving
   nonce #2 from a stale pending count → `"Nonce provided for the transaction
   is lower than the current nonce"`.

Fixed with a three-phase design:
- **Phase 1** — send all txs with **explicit sequential nonces**
  (`nonce: baseNonce + i`), never blocking between sends.
- **Phase 2** — wait for receipts with a 90s tolerance; a timeout logs `~`
  and is explicitly **not** treated as failure.
- **Phase 3** — `getPrice` read-back decides success. This is the only
  authority: it reverts if the price is missing OR expired.

**The generalisable lesson (3rd time this shape has bitten us — see also
Bug #6):** never infer on-chain state from a transaction's apparent outcome.
A green receipt can be against the wrong contract; a timed-out receipt can be
a success. Read the state back.

### Known limitations — must address post-launch
1. **Prices are pinned fakes.** `USDC=$1.00`, `cbBTC=$60,000`, hardcoded in
   `PRICES`. Fine for testnet mock ERC20s. **Must NOT go to mainnet** — use
   Stork's Chain Pusher there (API key already in hand):
   https://docs.stork.network/getting-started/putting-data-on-chain
2. **No supervision.** If the keeper process dies, the protocol breaks within
   the hour with no alert. Needs a process manager or cron for anything
   longer-running than a watched launch.
3. **Burns gas continuously** — ~62k gas per cycle, 72 cycles/day. Negligible
   on testnet; check relayer balance periodically anyway.

### Prevention
- Keeper must be running before any demo, test, or launch. It is now the
  fourth required service alongside dapp, data-api, and Postgres.
- Its startup log prints signer, oracle, and gas balance — read them to
  confirm it's pointed at the live oracle (Bug #6's failure mode).

---

<!-- NEXT-BUG-ANCHOR -->

## Template for Future Bugs

### Bug #X: [Title]

**Date**: YYYY-MM-DD  
**Severity**: [Low/Medium/High/Critical]  
**Status**: [Open/In Progress/Resolved/Won't Fix]

#### Symptoms
- What error/behavior was observed?
- Where did it occur?
- What was the user trying to do?

#### Root Cause
- What actually caused the bug?
- Why did it happen?

#### Attempted Fixes
1. **Fix #1**: Description
   - **Result**: Success/Failure/Partial
   
2. **Fix #2**: Description
   - **Result**: Success/Failure/Partial

#### Final Resolution
- What ultimately fixed the bug?
- Was it fully resolved?

#### Prevention
- How can we prevent this in the future?
- What checks/tests should be added?

#### Related Bugs
- Link to similar bugs if any

---

## Bug Categories

### Contract Configuration Bugs
- Oracle not seeded
- Rate models not initialized
- Assets not registered
- Missing role grants

### Deployment Bugs
- Wrong admin address
- Multiple conflicting deployments
- Stale deployment files
- Missing deployment steps

### Frontend Bugs
- Stale cache
- Wrong contract addresses
- Missing hard refresh after config changes

### Token/Balance Bugs
- Zero token balance
- Insufficient allowance
- Missing token mints for testing

### Network Bugs
- Wrong RPC endpoint
- Network mismatch
- Gas estimation failures

---

## Debugging Checklist

When encountering a contract revert:

1. **Identify the error**
   - [ ] Get error signature (e.g., 0x79993b73)
   - [ ] Look up in 4byte.directory
   - [ ] Check contract custom errors with `cast sig "ErrorName(types)"`
   
2. **Check contract state**
   - [ ] Verify contract addresses are correct
   - [ ] Check if contracts are properly initialized
   - [ ] Verify oracle has prices
   - [ ] Check rate models are initialized
   - [ ] Verify assets are registered
   
3. **Check user state**
   - [ ] Check token balance
   - [ ] Check token allowance
   - [ ] Check user has gas
   
4. **Check roles and permissions**
   - [ ] Verify admin has correct roles
   - [ ] Verify relayer has necessary roles
   - [ ] Check access control for function
   
5. **Check frontend**
   - [ ] Verify dapp is using correct contract addresses
   - [ ] Check browser console for errors
   - [ ] Hard refresh after config changes
   - [ ] Check network tab for actual transactions sent
   
6. **Check backend**
   - [ ] Verify data-api is running
   - [ ] Check data-api logs
   - [ ] Verify data-api has correct contract addresses
   
7. **Isolate the issue**
   - [ ] Try operation with cast directly
   - [ ] Test with minimal inputs
   - [ ] Check transaction simulation
   - [ ] Review recent code changes

---

## Common Error Signatures

| Signature | Error | Contract | Common Cause |
|-----------|-------|----------|--------------|
| 0x1f2a2005 | ZeroAmount() | Multiple | Attempting operation with 0 amount |
| 0xd92e233d | ZeroAddress() | Multiple | Passing address(0) to constructor/function |
| 0xc87701d8 | AssetNotEnabled(uint8) | ShieldedSupplyPool/ShieldedPositionPool | Asset not enabled in registry |
| 0xf26410e5 | AssetNotSuppliable(uint8) | ShieldedSupplyPool | Asset not marked as suppliable |
| 0x7c0447dd | NotInitialized(uint8) | RateModel | Rate model not initialized for asset |
| 0x58e0445f | PriceUnset(uint8) | Oracle | Oracle price not set for asset |
| 0x8d41104e | AssetNotConfigured(uint8) | AssetRegistry/RateModel | Asset doesn't exist in registry |
| 0xf50a3dcf | AlreadyInitialized(uint8) | RateModel | Attempting to re-initialize asset |
| **0x0868dfcf** | **PriceStale(uint8,uint64,uint64,uint32)** | **Oracle** | **Price older than staleness window. Carries updatedAt/nowTs/window in the revert data — DECODE IT. See Bug #5** |
| **0x79993b73** | **AggregationVerifyFailed()** | **ZkVerifier** | **zkVerify proxy Merkle check returned false. Usually the publish race, not a bad proof. See Bug #8** |
| **0x1a9f1d97** | **VkHashMismatch(uint8,bytes32,bytes32)** | **ZkVerifier** | **Circuit VK doesn't match the pinned hash — VkRegistry.sol out of sync with circuit artifacts** |
| **0xc5723b51** | **(Stork internal)** | **Stork contract** | **Stork has NO price data for that feed id on this chain. Not our bug — see Bug #5** |
| 0x000289a2 | StorkNotConfigured() | Oracle | Stork address is address(0) |

### Decoding an unknown signature

Do this **before** concluding a signature is unknown or searching 4byte —
three days were lost in Bug #1 by skipping it:

```bash
cd code/contracts
# Enumerate every custom error in a contract with its selector
grep -oE "error [A-Za-z]+\([^)]*\)" src/ZkVerifier.sol \
  | sed 's/error //' \
  | while read e; do echo "$(cast sig "$e" 2>/dev/null)  $e"; done
```

`cast sig` requires the **type-only** form: `cast sig "PriceStale(uint8,uint64,uint64,uint32)"`.
Including parameter names fails to parse — which is exactly why these looked
"unknown" the first time round.

Errors are inherited too: a revert surfacing from `supplyAsset` may be defined
in `ZkVerifier.sol`, `Oracle.sol`, `AssetRegistry.sol`, or OpenZeppelin
(`AccessControlUnauthorizedAccount` is a common one). Check the whole call path,
not just the entry contract.

---

## Notes

- Always read this file before debugging a new bug
- Update this file immediately after resolving a bug
- Include all relevant commands and code changes
- Link to related documentation when applicable
- Keep the debugging checklist updated with new discoveries
