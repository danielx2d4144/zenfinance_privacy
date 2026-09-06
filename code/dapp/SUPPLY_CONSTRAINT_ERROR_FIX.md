# Supply "Cannot Satisfy Constraint" Error - Root Cause & Fix

## Error Symptoms

When attempting to supply assets, the operation failed during proof generation with:
```
Failed
Something went wrong. See the message below.

✓ Generating proof
  Submitting to aggregator
  Aggregating with zkVerify
  Posting to chain
  Confirmed on-chain

Cannot satisfy constraint
```

## Root Cause Analysis

### The Problem

The error occurred because **notes stored in IndexedDB had stale leaf indices** that didn't match their actual positions in the local Incremental Merkle Tree (IMT) after recovery.

### Why This Happened

1. **Initial Deposit Flow (Correct)**:
   - User deposits → transaction creates commitment at on-chain index 19
   - Note saved to IndexedDB with `leafIdx: 19`
   - Local IMT mirrors on-chain tree → commitment at position 19
   - ✅ Everything matches

2. **Recovery Flow (Broken)**:
   - Recovery scan fetches 22 on-chain deposits with their original indices
   - Example: deposits at on-chain indices [0, 1, 2, 3, 4, 19, 20, 21, ...]
   - Local IMT inserts them **sequentially** → new indices [0, 1, 2, 3, 4, 5, 6, 7, ...]
   - Deposit at on-chain index 19 gets local index 10
   - Notes loaded from IndexedDB still have `leafIdx: 19`
   - ❌ **Mismatch**: Note says position 19, but commitment is at position 10

3. **Proof Generation Failure**:
   - Circuit asks for Merkle proof at position 19
   - Local IMT generates siblings for position 19 (wrong commitment)
   - Circuit verifies: `hash(siblings[19]) != expected_root`
   - ❌ Constraint not satisfied

### Key Insight

The local IMT **sorts deposits by on-chain index** before inserting sequentially:
```typescript
const sortedDeposits = [...view.depositLeaves].sort((a, b) => a.leafIndex - b.leafIndex);
for (const { commitment } of sortedDeposits) {
  entryImtRef.current.insert(BigInt(commitment));  // Gets indices 0, 1, 2, ...
}
```

If on-chain indices have gaps (due to withdrawals in other wallets or multi-pool architecture), the local sequential indices won't match.

### Why The Initial Fix Didn't Work

**Attempt 1**: Build a `commitmentToLocalIdx` map and update notes during recovery.

```typescript
for (const note of notes) {
  if (!noteStoreRef.current.get(note.leafHex)) {
    // Only updates NEW notes, not existing ones from IndexedDB!
    note.preimage.leafIdx = commitmentToLocalIdx.get(note.leafHex);
    noteStoreRef.current.registerHex(note.leafHex, note.preimage);
  }
}
```

**Why it failed**: The `if (!noteStoreRef.current.get(...))` condition was FALSE for existing notes loaded from IndexedDB, so they never got updated.

## The Fix

### Solution

Update ALL recovered notes (new and existing) with their correct local IMT indices:

```typescript
for (const note of notes) {
  if (note.spent) {
    noteStoreRef.current.forget(note.leafHex);
    continue;
  }

  // Update leafIdx BEFORE checking if note exists
  const localIdx = commitmentToLocalIdx.get(note.leafHex.toLowerCase());
  if (localIdx !== undefined) {
    note.preimage.leafIdx = localIdx;
  }

  // Register note (overwrites existing entries in IndexedDB)
  if (!noteStoreRef.current.get(note.leafHex)) {
    recovered += 1;
  }
  noteStoreRef.current.registerHex(note.leafHex, note.preimage);
}
```

### Key Changes

1. **Always update leafIdx** for all recovered notes, not just new ones
2. **Move index update BEFORE** the existence check
3. **Always call registerHex** to persist the corrected index to IndexedDB

### Files Modified

- `code/dapp/src/hooks/useSpendingKey.tsx` - Updated recovery flow to remap all note indices
- `code/dapp/src/components/LendingForm.tsx` - Added validation and debugging logs

## Debugging Strategy

Added comprehensive logging to diagnose the issue:

1. **IMT Hydration Logs**:
   ```
   [useSpendingKey] Hydrating IMT with deposits: 22
   [0] on-chain idx=0, local idx=0, commitment=0x1ba77605...
   [10] on-chain idx=19, local idx=10, commitment=0x03bf6608...
   ```

2. **Note Recovery Logs**:
   ```
   [useSpendingKey] Processing notes: 14
   Note 0x3bf66086... original idx=19, local idx=10, kind=balance
   ```

3. **Proof Generation Logs**:
   ```
   [prepareSupply] IMT check: {
     noteLeafIdx: 19,
     leafAtPosition: "0xab0c3aef...",
     expectedCommitment: "0x3bf66086...",
     match: false  ← This revealed the mismatch
   }
   ```

These logs clearly showed:
- On-chain index 19 → local index 10
- Note had leafIdx 19 (stale)
- Leaf at position 19 didn't match note's commitment

## User Recovery Steps

If users encounter this error, they must clear ALL IndexedDB databases:

```javascript
(async () => {
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    indexedDB.deleteDatabase(db.name);
    console.log('Deleted:', db.name);
  }
  localStorage.clear();
  location.reload();
})();
```

**Important**: The database name is `zenfinance-notes:v1:{chainId}:{address}` (with colons), not `zenfinance-notes-v1` (with hyphens). Clearing just `zenfinance-notes-v1` doesn't work!

## Prevention

### Why This Architecture?

The current approach (sequential local IMT) was chosen for simplicity during initial development. The on-chain tree can have gaps, but the local tree can't efficiently represent sparse indices.

### Future Improvements

**Option A: Sparse IMT (Recommended Long-Term)**
- Extend `LocalIMT` to support `insertAt(commitment, index)` 
- Fill gaps with zero leaves
- Local tree perfectly mirrors on-chain structure
- No index remapping needed

**Option B: Always Use On-Chain Indices**
- Never store leafIdx in notes
- Query on-chain for the commitment's index when needed
- ❌ Privacy leak: reveals which notes you own
- ❌ Network dependency

**Option C: Store Both Indices**
```typescript
interface BalanceNotePreimage {
  onChainIdx: number;   // Original on-chain position
  localIdx: number;     // Position in local IMT
  // ...
}
```
- More complex but explicit
- Easier debugging

## Testing Checklist

To verify the fix works:

1. ✅ Fresh unlock → deposit → supply (new user flow)
2. ✅ Existing notes → clear storage → unlock → supply (recovery flow)
3. ✅ Multiple deposits → recovery → verify all notes get correct indices
4. ✅ Check console logs confirm index remapping
5. ✅ Verify IMT root matches on-chain root after recovery

## Related Issues

- **leafIdx validation error**: Fixed by adding bounds checking before `proofFor()`
- **CORS error**: Fixed by adding test-v3.noctfinance.xyz to Railway backend CORS_ORIGINS
- **Price stale error**: Fixed by deploying price-keeper to Railway (24/7 operation)

## Commit History

1. `f88f22c` - Add leafIdx validation to prevent out-of-range errors
2. `[current]` - Fix leafIdx remapping during recovery to match local IMT structure

## Lessons Learned

1. **IndexedDB persistence is invisible** - Clearing localStorage isn't enough
2. **Index mismatches are subtle** - Everything works until you spend
3. **Log everything during recovery** - Impossible to debug without visibility
4. **Test recovery flow explicitly** - Don't assume "clear storage" clears everything
5. **Database names matter** - `zenfinance-notes:v1:...` vs `zenfinance-notes-v1`
