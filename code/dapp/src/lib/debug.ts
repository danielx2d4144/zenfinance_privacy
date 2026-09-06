/**
 * Central debug logging utility.
 *
 * Set DEBUG=true in .env.local to enable verbose logging in development.
 * Production builds (process.env.NODE_ENV === 'production') ignore the flag
 * and only log warnings/errors unless explicitly enabled.
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEBUG_ENABLED = process.env.NEXT_PUBLIC_DEBUG === 'true';

/**
 * Debug log - only shows when DEBUG flag is enabled.
 * Use for detailed implementation logs (IMT hydration, note processing, etc.)
 */
export function debugLog(scope: string, message: string, data?: any): void {
  if (!DEBUG_ENABLED && IS_PRODUCTION) return;

  const prefix = `[${scope}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

/**
 * Info log - always shows, use for important user-facing events.
 * Examples: "Wallet connected", "Transaction submitted", "Recovery complete"
 */
export function infoLog(scope: string, message: string, data?: any): void {
  const prefix = `[${scope}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

/**
 * Warning log - always shows, use for recoverable issues.
 * Examples: "Note commitment not found", "Network slow", "Fallback to cached data"
 */
export function warnLog(scope: string, message: string, data?: any): void {
  const prefix = `[${scope}]`;
  if (data !== undefined) {
    console.warn(prefix, message, data);
  } else {
    console.warn(prefix, message);
  }
}

/**
 * Error log - always shows, use for failures.
 * Examples: "Recovery scan failed", "Transaction rejected", "Invalid proof"
 */
export function errorLog(scope: string, message: string, error?: any): void {
  const prefix = `[${scope}]`;
  if (error !== undefined) {
    console.error(prefix, message, error);
  } else {
    console.error(prefix, message);
  }
}

/**
 * Group start - only shows when DEBUG flag is enabled.
 * Use to group related debug logs together (collapsible in console).
 */
export function debugGroup(scope: string, label: string): void {
  if (!DEBUG_ENABLED && IS_PRODUCTION) return;
  console.group(`[${scope}] ${label}`);
}

/**
 * Group end - matches debugGroup.
 */
export function debugGroupEnd(): void {
  if (!DEBUG_ENABLED && IS_PRODUCTION) return;
  console.groupEnd();
}

/**
 * Check if debug logging is enabled.
 * Use this to skip expensive log data preparation when debug is off.
 */
export function isDebugEnabled(): boolean {
  return DEBUG_ENABLED || !IS_PRODUCTION;
}
