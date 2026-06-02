export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export const defaultRetry: RetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  jitter: true,
};

export type RetryDecision =
  | { retry: false }
  | { retry: true; delayMs: number };

export function backoff(attempt: number, opts: RetryOptions): number {
  const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
  if (!opts.jitter) return exp;
  return Math.floor(Math.random() * exp);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  shouldRetry: (err: unknown) => RetryDecision,
  opts: RetryOptions = defaultRetry,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const decision = shouldRetry(err);
      if (!decision.retry || attempt === opts.maxAttempts) break;
      await sleep(decision.delayMs);
    }
  }
  throw lastErr;
}
