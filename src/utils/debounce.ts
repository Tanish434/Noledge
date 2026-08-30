/**
 * @file utils/debounce.ts
 * @description Debounce utility — delays execution until after a quiet period.
 *
 * A debounced function waits for `delay` milliseconds after the LAST call
 * before actually executing. Useful for search inputs, auto-save, and any
 * event that fires rapidly but where only the final value matters.
 *
 * Difference from throttle (see throttle.ts):
 *   - Debounce: "Execute X ms AFTER the last call." Good for: search, resize.
 *   - Throttle: "Execute AT MOST once every X ms." Good for: scroll, mousemove.
 *
 * This implementation is generic over the function signature, so TypeScript
 * preserves full type inference for the wrapped function's parameters and
 * return type (though the debounced function always returns void — the
 * original return value is not accessible from outside).
 */

// The generic type parameter T is constrained to "any function signature".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => void;

/**
 * DebouncedFunction<T> — the type of the value returned by debounce().
 *
 * It has the same call signature as T, plus a `cancel()` method to clear
 * any pending invocation. This is important for React cleanup — call
 * `debouncedFn.cancel()` in the useEffect cleanup to prevent state updates
 * on unmounted components.
 */
export type DebouncedFunction<T extends AnyFunction> = {
  (...args: Parameters<T>): void;
  cancel: () => void;
};

/**
 * debounce — wrap a function so it executes after a quiet period.
 *
 * @param fn    The function to debounce
 * @param delay Quiet period in milliseconds. The function runs after
 *              `delay` ms have elapsed since the most recent call.
 * @returns     A debounced version of `fn` with a `cancel()` method
 *
 * @example
 *   const debouncedSearch = debounce((query: string) => {
 *     fetchResults(query);
 *   }, 300);
 *
 *   // In cleanup:
 *   debouncedSearch.cancel();
 */
export function debounce<T extends AnyFunction>(fn: T, delay: number): DebouncedFunction<T> {
  // The timer ID is held in closure so it persists across calls.
  // We use ReturnType<typeof setTimeout> for cross-environment compatibility
  // (setTimeout returns `number` in browsers, `NodeJS.Timeout` in Node).
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<T>): void => {
    // Clear any existing timer — this is the "reset the clock" step.
    // If the user keeps calling the function, the timer keeps resetting
    // and fn is never called until they stop calling for `delay` ms.
    if (timerId !== null) {
      clearTimeout(timerId);
    }

    // Schedule a new invocation.
    timerId = setTimeout(() => {
      timerId = null;    // Clear the reference so we don't try to clear it again
      fn(...args);
    }, delay);
  };

  // cancel() — clear any pending invocation without calling fn.
  // Use in React useEffect cleanup, component unmount, etc.
  debounced.cancel = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  return debounced as DebouncedFunction<T>;
}
