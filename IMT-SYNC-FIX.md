# IMT Sync Issue - Fix Instructions

## Problem
`LocalIMT.proofFor: idx 0 out of range [0, 0)` means the local Merkle tree is empty.

## Root Cause
After the V3 deployment (new contracts), your browser's IndexedDB has stale state. The deposit created a note on-chain, but the local tree didn't sync it.

## Fix (Run in Browser Console - F12)

```javascript
// Step 1: Clear ALL storage
await indexedDB.databases().then(dbs => {
  dbs.forEach(db => indexedDB.deleteDatabase(db.name));
});
localStorage.clear();
sessionStorage.clear();

console.log("✅ Storage cleared");

// Step 2: Reload the page
setTimeout(() => {
  console.log("Reloading...");
  location.reload();
}, 2000);
```

## After Reload

1. **Connect wallet** again
2. **Unlock with spending key**
3. **Wait for sync** - You should see "Scanning blocks..." in the UI
4. **Check balance** - Your deposited USDC should appear
5. **Try supply** - Should work now

## If Still Fails

The IMT hydration might be failing. Check:

1. **Deployment block is correct** in `.env.local`:
   ```
   NEXT_PUBLIC_HORIZEN_DEPLOY_BLOCK=26008305
   ```

2. **Note recovery is working**:
   - Open browser console
   - Look for "Recovered N notes" messages
   - If you see 0 notes recovered, the spending key might be wrong

## Verification

After clearing storage and unlocking:
- Go to browser DevTools → Application → IndexedDB
- Check `zenfinance` database → `notes` table
- Should have 1+ entries (your deposit note)

If notes table is empty, the recovery process failed - likely wrong spending key or RPC issue.
