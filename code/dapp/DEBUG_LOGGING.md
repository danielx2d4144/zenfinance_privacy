# Debug Logging System

## Overview

The dApp uses a centralized debug logging system that allows you to control verbosity via environment variables.

## Log Levels

### `debugLog(scope, message, data?)` 
**Visibility**: Only when `NEXT_PUBLIC_DEBUG=true`

Use for detailed implementation logs that are helpful during development but unnecessary in production:
- IMT hydration details (on-chain vs local indices)
- Note processing during recovery
- Commitment mapping
- Detailed proof generation data

### `infoLog(scope, message, data?)`
**Visibility**: Always shown

Use for important user-facing events:
- "Wallet connected"
- "IMT hydrated" (summary only)
- "Transaction submitted"
- "Recovery complete"

### `warnLog(scope, message, data?)`
**Visibility**: Always shown

Use for recoverable issues:
- "Note commitment not found in map"
- "Network request slow, retrying"
- "Using cached data"

### `errorLog(scope, message, error?)`
**Visibility**: Always shown

Use for failures:
- "Recovery scan failed"
- "Transaction rejected"
- "Invalid proof"

## Usage

### Enable Debug Logging

**Development:**
```bash
# In code/dapp/.env.local
NEXT_PUBLIC_DEBUG=true
```

**Production:**
Debug logs are automatically suppressed in production builds unless explicitly enabled.

### Example

```typescript
import { debugLog, infoLog, warnLog, errorLog } from "@/lib/debug";

// Detailed debug info (only shows when DEBUG=true)
debugLog("useSpendingKey", `Processing note at index ${idx}`);

// Important user-facing event (always shows)
infoLog("useSpendingKey", "IMT hydrated", { entryCount: 22 });

// Warning (always shows)
warnLog("useSpendingKey", "Note not found in map", commitment);

// Error (always shows)
errorLog("useSpendingKey", "Recovery failed", error);
```

## Console Output

**With `NEXT_PUBLIC_DEBUG=true`:**
```
[useSpendingKey] Hydrating IMT with deposits: 22
[useSpendingKey]   [0] on-chain idx=0, local idx=0, commitment=0x1ba77605...
[useSpendingKey]   [1] on-chain idx=1, local idx=1, commitment=0x11111111...
[useSpendingKey] IMT hydrated { entryCount: 22, entryRoot: "0x2493b2e9...", leafCount: 33 }
[useSpendingKey] Processing notes: 14
[useSpendingKey]   Note 0x3bf66086... original idx=19, local idx=10, kind=balance
[prepareSupply] snapshot { slot: 0, supplyIndexRaw: 1000000000000n, ... }
[prepareSupply] IMT check { noteLeafIdx: 10, match: true, ... }
```

**With `NEXT_PUBLIC_DEBUG=false` (production default):**
```
[useSpendingKey] IMT hydrated { entryCount: 22, entryRoot: "0x2493b2e9...", leafCount: 33 }
```

Only `infoLog`, `warnLog`, and `errorLog` appear.

## When to Use Each Level

| Scenario | Level | Reason |
|----------|-------|--------|
| Index mapping during recovery | `debugLog` | Implementation detail, noisy |
| Individual note processing | `debugLog` | Too verbose for production |
| IMT hydration summary | `infoLog` | Important milestone |
| Recovery completion | `infoLog` | User-facing event |
| Missing commitment in map | `warnLog` | Potential issue but recoverable |
| Network timeout | `warnLog` | User should know, but not fatal |
| Recovery scan crash | `errorLog` | Critical failure |
| Transaction rejected | `errorLog` | User needs to act |

## Benefits

1. **Clean Production Logs**: Users don't see implementation details
2. **Easy Debugging**: Set `DEBUG=true` to see everything
3. **Consistent Format**: All logs use `[scope] message` pattern
4. **Centralized Control**: One place to change logging behavior
5. **Performance**: Expensive log data preparation can be skipped when debug is off

## Migration from console.log

Before:
```typescript
console.log("[useSpendingKey] Processing note:", note);
console.warn("WARNING: Note not found");
```

After:
```typescript
debugLog("useSpendingKey", "Processing note", note);
warnLog("useSpendingKey", "Note not found");
```

## Advanced: Conditional Logic

Skip expensive operations when debug is off:

```typescript
import { isDebugEnabled, debugLog } from "@/lib/debug";

if (isDebugEnabled()) {
  const expensiveData = computeDetailedStats(); // Only runs when DEBUG=true
  debugLog("myScope", "Stats", expensiveData);
}
```
