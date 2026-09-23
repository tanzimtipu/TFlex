/**
 * DEF-303 — the caption-maximize sequence for a window, kept as a tiny pure
 * planner so the restore rule is unit-testable without an Electron window.
 *
 * Background: `win.maximize()` on a still-minimised window is Electron/Windows
 * stacking a restore AND a maximise (two DWM transitions, measured ~152 ms to
 * the `maximize` event versus ~51 ms from the restored state). `win.restore()`
 * is documented to return the window from the minimised state to its PREVIOUS
 * state in a single transition — so when the window was maximised before it
 * was minimised, one `restore()` is the whole job and a following `maximize()`
 * is a redundant second transition.
 */
export type CaptionMaximizeStep = 'restore' | 'maximize' | 'unmaximize';

export interface CaptionMaximizeState {
  /** `win.isMinimized()` at the moment the caption maximize IPC arrived. */
  minimized: boolean;
  /** `win.isMaximized()` at the same moment. While minimised this is false. */
  maximized: boolean;
  /**
   * Whether the window was maximised BEFORE it was minimised. Only meaningful
   * when `minimized` is true: the caller resolves it from the window's last
   * known maximised state, because `isMaximized()` reports false while the
   * window sits minimised.
   */
  previouslyMaximized: boolean;
}

/**
 * The ordered calls the caption-maximize handler must make.
 *
 * - Not minimised: the existing single-action toggle (maximize <-> unmaximize),
 *   one transition, unchanged.
 * - Minimised + previously maximised: only `restore()` — it returns the window
 *   to the maximised state in one transition.
 * - Minimised + previously normal: `restore()` then `maximize()` — the restore
 *   lands in the normal state, then one maximize reaches the requested state.
 */
export function planCaptionMaximize(state: CaptionMaximizeState): CaptionMaximizeStep[] {
  if (state.minimized) {
    return state.previouslyMaximized ? ['restore'] : ['restore', 'maximize'];
  }
  return state.maximized ? ['unmaximize'] : ['maximize'];
}
