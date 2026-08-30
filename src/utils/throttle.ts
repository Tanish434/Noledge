/**
 * @file utils/throttle.ts
 * @description Throttle utility — limits execution to at most once per interval.
 *
 * A throttled function executes immediately on the first call, then waits
 * `limit` milliseconds before allowing the next execution. If called during
 * the waiting period, the call is queued and fires when the period ends
 * (trailing call).
 *
 * Difference from debounce (see debounce.ts):
 *   - Debounce: fires AFTER quiet period. Good for: search, resize, auto-save.
 *   - Throttle: fires IMMEDIATELY then waits. Good for: scroll, mousemove,
 *     any event where immediate feedback matters AND you want a ceiling on
 *     how often the handler runs.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => void;

/**
 * ThrottledFunction<T> — same call signature as T plus a cancel() method.
 */
export type ThrottledFunction<T extends AnyFunction> = {
  (...args: Parameters<T>): void;
  cancel: () => void;
};

/**
 * throttle — limit a function to execute at most once per `limit` ms.
 *
 * This is a "leading + trailing" throttle:
 *   - Leading edge: executes immediately on first call in the period.
 *   - Trailing edge: if there were calls during the cooldown, fires once more
 *     at the end of the period with the most recent arguments.
 *
 * @param fn    The function to throttle
 * @param limit Minimum milliseconds between executions
 * @returns     A throttled version of `fn` with a `cancel()` method
 */
export function throttle<T extends AnyFunction>(fn: T, limit: number): ThrottledFunction<T> {
  let lastCallTime: number | null = null;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const throttled = (...args: Parameters<T>): void => {
    const now = Date.now();
    lastArgs = args;

    if (lastCallTime === null || now - lastCallTime >= limit) {
      // Leading edge: first call or enough time has passed.
      lastCallTime = now;
      fn(...args);
    } else {
      // Within the cooldown period: schedule a trailing call.
      // Clear any existing trailing timer (only the LAST call in the
      // cooldown period should fire, not every call).
      if (trailingTimer !== null) {
        clearTimeout(trailingTimer);
      }
      const remaining = limit - (now - lastCallTime);
      trailingTimer = setTimeout(() => {
        lastCallTime = Date.now();
        trailingTimer = null;
        if (lastArgs) {
          fn(...lastArgs);
        }
      }, remaining);
    }
  };

  throttled.cancel = (): void => {
    if (trailingTimer !== null) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
    lastCallTime = null;
    lastArgs = null;
  };

  return throttled as ThrottledFunction<T>;
}
