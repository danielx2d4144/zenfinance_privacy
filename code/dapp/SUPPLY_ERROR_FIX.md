# Debugging the Supply Error

The error `LocalIMT.proofFor: idx 19 out of range [0, 19)` means:
- The local IMT has 19 leaves (indices 0-18)
- A note in your NoteStore has `leafIdx: 19` (invalid)
- When you try to supply, it calls `proofFor(19)` which fails

## Root Cause

This happens when:
1. A deposit note's leafIdx wasn't properly updated from its placeholder value
2. The WAL reconciliation assigned the wrong index
3. A cached note has a stale/incorrect leafIdx

## Quick Fix - Clear Your Session

Open the browser console on localhost:3000 and run:

```javascript
// Clear the encrypted vault
indexedDB.deleteDatabase('zenfinance-notes-v1');

// Clear localStorage
localStorage.clear();

// Reload
location.reload();
```

Then:
1. Reconnect your wallet
2. Sign to unlock (it will re-scan and recover your notes)
3. Try the supply operation again

This will force a full re-scan and should fix the leafIdx mismatch.

## Permanent Fix (Code Change)

The issue is that when recovering notes, if there's a mismatch between:
- The local IMT state (19 leaves = indices 0-18)
- A note's stored leafIdx (19, which is invalid)

We need to add validation to prevent this. Let me implement a fix.
