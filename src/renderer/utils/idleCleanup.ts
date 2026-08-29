/**
 * Idle-cleanup coordinator for the active pdf.js document.
 *
 * pdf.js keeps per-document caches resident in the worker thread for the
 * lifetime of the `PDFDocumentProxy`:
 *
 *   - font cache (loaded TrueType / OpenType data, cmaps)
 *   - global image cache (decoded JPEG / JPX / JBig2 bitmaps)
 *   - pageDictCache / pageIndexCache / pageKidsCountCache
 *   - standardFontDataCache / builtInCMapCache / systemFontCache
 *
 * `PDFDocumentProxy.cleanup()` (async, returns a Promise) flushes every one
 * of those — see the catalog.cleanup() implementation in pdf.worker.mjs.
 * Without it, every page ever rendered (and every font ever translated)
 * stays alive for the whole session, which is the dominant idle-time
 * memory contributor in the renderer for long PDFs (DEF-016 exit target:
 * renderer <=150 MB idle).
 *
 * The catch is the documented warning: do NOT call cleanup while a render
 * is in flight on the same document. The idle coordinator here treats
 * `isBusy` as authoritative: cleanup only fires after `idleMs` of quiet
 * AND `isBusy()` reports false at fire-time.
 *
 * Activity model:
 *   - `noteActivity()` is called by the host on every user-visible event
 *     that touches the document (scroll, IO change, search, annotation).
 *     Each call resets the idle window so cleanup will not fire until
 *     `idleMs` of new quiet elapses.
 *   - `requestCleanup()` schedules cleanup if not already armed. The
 *     host calls this once when a document mounts; `noteActivity()` then
 *     keeps pushing out the timer as long as the user is active.
 *   - `cancel()` drops any pending cleanup. Call on document change /
 *     unmount so a pending cleanup against an obsolete doc does not fire
 *     after the new doc is mounted.
 *
 * Semantics: cleanup is one-shot. Once the timer fires, `armed` flips to
 * false. The host must call `requestCleanup()` again to schedule another
 * cleanup. We deliberately don't auto-rearm on every idle moment — that
 * would flush pdf.js's caches between every scroll-stop, which is
 * expensive (the next page render re-parses fonts from the document
 * stream). One cleanup per document mount is the right cost/benefit.
 *
 * The helper is intentionally framework-agnostic: it takes a single
 * `cleanup` callback that returns a `Promise<unknown>` (whatever
 * `PDFDocumentProxy.cleanup()` returns) plus an `isBusy` probe. This
 * makes it unit-testable without pdf.js, without a renderer, without
 * a DOM, and without fake timers — the host supplies `setTimer` /
 * `clearTimer` to drive the idle window deterministically.
 */

export interface IdleCleanupCoordinator {
  /** Call whenever any user-visible activity touches the document.
   *  Resets the idle window so cleanup will not fire until `idleMs`
   *  of new quiet elapses. A no-op if no cleanup is currently armed. */
  noteActivity(): void;
  /** Probe supplied by the host: returns true while a render is in flight
   *  on the document. Used to gate the cleanup call (pdf.js refuses
   *  cleanup during active renders). */
  isBusy(): boolean;
  /** Schedule cleanup if not already armed. Coalesces: if a cleanup
   *  is already armed, this call is a no-op. After the cleanup fires,
   *  the host must call requestCleanup() again to schedule another. */
  requestCleanup(): void;
  /** Drop any pending cleanup. Call on document change / unmount so a
   *  pending cleanup against an obsolete doc does not fire after the
   *  new doc is mounted. */
  cancel(): void;
  /** Test-only: report whether a cleanup is currently scheduled. */
  isPending(): boolean;
}

export interface IdleCleanupOptions {
  /** How long the document must be quiet (no `noteActivity()` calls and
   *  `isBusy() === false`) before cleanup fires. Defaults to 5000ms. */
  idleMs?: number;
  /** Override the timer factory — used by the unit tests to drive the
   *  idle window deterministically without leaking real intervals. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createIdleCleanupCoordinator(
  cleanup: () => Promise<unknown>,
  isBusy: () => boolean,
  options: IdleCleanupOptions = {},
): IdleCleanupCoordinator {
  const idleMs = options.idleMs ?? 5000;
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let timer: unknown = null;
  let armed = false;

  const clearTimerIfAny = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const arm = (): void => {
    clearTimerIfAny();
    timer = setTimer(() => {
      timer = null;
      armed = false;
      // Skip if the document is mid-render — pdf.js would refuse anyway.
      if (isBusy()) {
        return;
      }
      // Fire the cleanup. We intentionally do not track the in-flight
      // promise: cleanup is best-effort, and the host must explicitly
      // re-arm with another requestCleanup() if it wants another pass.
      // A rejection (e.g. pdf.js worker torn down mid-call) is swallowed
      // because the next cleanup attempt would face the same condition.
      Promise.resolve()
        .then(cleanup)
        .catch(() => undefined);
    }, idleMs);
  };

  return {
    noteActivity(): void {
      if (!armed) return;
      arm();
    },
    isBusy,
    requestCleanup(): void {
      if (armed) {
        return;
      }
      armed = true;
      arm();
    },
    cancel(): void {
      armed = false;
      clearTimerIfAny();
    },
    isPending(): boolean {
      return armed;
    },
  };
}
