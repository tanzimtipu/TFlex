/**
 * Trailing-edge debouncer.
 *
 * Coalesces rapid calls into a single invocation of the wrapped function
 * after `waitMs` of quiet. The latest argument set always wins. Returns a
 * stable handle with `flush()` (invoke immediately if pending) and `cancel()`
 * (drop the pending invocation) so callers can compose lifecycle around it.
 */
export interface DebouncedFn<Args extends unknown[]> {
  (...args: Args): void;
  /** Invoke immediately if a call is pending, then clear the timer. */
  flush(): void;
  /** Drop any pending invocation without calling the wrapped function. */
  cancel(): void;
}

export function createDebouncer<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): DebouncedFn<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Args | null = null;

  const fire = (): void => {
    timer = null;
    const args = pendingArgs;
    pendingArgs = null;
    if (args !== null) {
      fn(...args);
    }
  };

  const debounced = ((...args: Args): void => {
    pendingArgs = args;
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(fire, waitMs);
  }) as DebouncedFn<Args>;

  debounced.flush = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    fire();
  };

  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pendingArgs = null;
  };

  return debounced;
}
