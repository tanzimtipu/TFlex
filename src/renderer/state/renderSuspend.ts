// DEF-303 — the renderer half of the minimised-window pause.
//
// `backgroundThrottling: false` was tried and reverted: qa measured that
// Chromium STILL suspends a minimised window's frames (~1 rAF frame/s), so
// the option bought no latency and only cost CPU while minimised. Chromium's
// frame suspension also means `document.hidden`/`visibilitychange` cannot be
// relied on to detect a minimise. Main therefore pushes an explicit pause
// signal (`window:minimizedChanged`, `{ minimized }`) on the window's
// `minimize`/`restore` events, and this module is the ONE suspend state
// every expensive render/raster entry point consults.
//
// Work requested while suspended is NOT dropped. `deferWork` parks the
// callback in a queue and the callback runs (in registration order) the
// instant the window is restored, so nothing is lost and the first paint
// after restore is already correct — no artificial delay is added on
// resume. `waitForRenderActive` is the same contract for a long chunked
// loop that must yield mid-work (the search-index walk): it parks the loop
// between chunks and releases it on resume with its progress intact.
//
// Kept framework-free so it can be unit-tested without React, a DOM or
// pdf.js. The React binding is the `useMinimizedPause` hook, which owns
// the single IPC subscription and calls `setRenderSuspended`.

export type RenderSuspendListener = (suspended: boolean) => void;

let suspended = false;
let workSeq = 0;
const listeners = new Set<RenderSuspendListener>();
const pending = new Map<number, () => void>();
const waiters = new Set<() => void>();

/** True while the window is minimised and expensive render work must be
 *  parked rather than run. */
export function isRenderSuspended(): boolean {
  return suspended;
}

/** Subscribe to suspend-state changes (the React hook uses this). Returns
 *  an unsubscribe. */
export function subscribeRenderSuspend(listener: RenderSuspendListener): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

/** Flip the suspend state. Idempotent on repeats. Resuming flushes the
 *  parked work BEFORE the listeners are notified, so a listener that
 *  re-renders React never re-parks the work that was just flushed. */
export function setRenderSuspended(next: boolean): void {
  if (next === suspended) return;
  suspended = next;
  if (!suspended) {
    flushPendingWork();
    resumeWaiters();
  }
  for (const listener of listeners) listener(suspended);
}

/**
 * Resolve immediately when the window is active; while suspended, resolve
 * on resume. Used by long chunked loops (the search-index walk) that must
 * yield mid-work: awaiting this parks the loop without losing its progress.
 */
export function waitForRenderActive(): Promise<void> {
  if (!suspended) return Promise.resolve();
  return new Promise<void>((resolve) => {
    waiters.add(resolve);
  });
}

/**
 * Run `run` now when the window is active; park it and run it once on
 * resume when the window is minimised. Returns a cancel that drops the
 * parked callback (used by effect cleanups so a stale request never
 * fires after its component changed or unmounted).
 */
export function deferWork(run: () => void): () => void {
  if (!suspended) {
    run();
    return (): void => undefined;
  }
  workSeq += 1;
  const key = workSeq;
  pending.set(key, run);
  return (): void => {
    pending.delete(key);
  };
}

function flushPendingWork(): void {
  if (pending.size === 0) return;
  // Snapshot then clear so a callback that requests more work does not
  // re-enter the flush (that new request runs with suspended === false).
  const queued = Array.from(pending.values());
  pending.clear();
  for (const run of queued) run();
}

function resumeWaiters(): void {
  if (waiters.size === 0) return;
  const resolvers = Array.from(waiters);
  waiters.clear();
  for (const resolve of resolvers) resolve();
}

/** Test-only: return the module to its boot state. */
export function resetRenderSuspendForTests(): void {
  suspended = false;
  pending.clear();
  waiters.clear();
  listeners.clear();
  workSeq = 0;
}
