// DEF-077 — pure priority resolver for the diagnostics surface.
//
// `tflexDiagnostics()` in App.tsx reads the active tab's EngineState
// from two sources:
//
//   1. The React `engineUi` mirror (set by every op-completion
//      handler — `noteOpApplied` for state-returning engine ops,
//      `setEngineUiFor` for non-state-returning ops like save /
//      saveAs / split / extract / optimize).
//   2. The engine adapter's `peekLastState` cache, which captures
//      direct `window.tflex.engine.*` calls synchronously.
//
// The dispatch rules (and the React #520 crash they caused):
//
//   Pre-fix — `tflexDiagnostics()` fired a fire-and-forget
//   `getState` round-trip + a `setEngineUiFor` dispatch whenever
//   the cache and mirror disagreed. An e2e harness that polled
//   the surface in a tight loop scheduled one `getState` +
//   `setEngineUi` dispatch per call. The dispatches queued more
//   renders, exceeded React-19's max-update-depth guard, and
//   collapsed the tree (Error #520).
//
//   Post-fix — `tflexDiagnostics()` is a PURE read: it consults
//   the two sources synchronously and never schedules IPC or
//   state updates. The mirror converges via op-completion
//   handlers (already wired in App.tsx), so by the time the
//   harness reads diagnostics, the mirror is in sync with every
//   UI-driven op. The cache is the synchronous fallback for
//   direct engine calls that haven't yet triggered a React
//   re-render — when the mirror is still null (between a direct
//   call and the next render), `peekLastState` fills the gap.
//
// `resolveEngineStateForDiagnostics` is the single source of
// truth for that priority: mirror first, cache only when the
// mirror is unseeded. Extracting it here lets the unit test
// pin the contract without rendering the whole App tree, and
// gives App.tsx a single function to call instead of inlining
// the logic.

import type { EngineState } from "../engine/types";

/** Return the EngineState that `tflexDiagnostics()` should
 *  surface for the active tab. Pure read — no IPC, no
 *  `setEngineUi`-style dispatch. The mirror (populated by
 *  op-completion handlers) wins when it has been seeded; the
 *  adapter cache fills the gap only when the mirror is still
 *  null (e.g. between a direct `window.tflex.engine.applyOp`
 *  call and the next React render). */
export function resolveEngineStateForDiagnostics(
  mirrored: EngineState | null,
  cached: EngineState | null,
): EngineState | null {
  return mirrored ?? cached;
}

/** True when a tab's diagnostics publish may update the shared
 *  diagnostics mirror. Publishes from tabs that are no longer open
 *  are DROPPED (DEF-097).
 *
 *  Rationale: `closeTab` resets `activeTool: null` in the mirror so
 *  a read after the close is honest. The closing tab's DocumentView
 *  (and any late effect / async callback keyed to that tab id) may
 *  still fire a diagnostics publish during the close commit; without
 *  this gate that publish re-spreads the stale `activeTool` (e.g.
 *  "highlight") over the reset and the diagnostics surface keeps
 *  reporting the closed tab's tool. Gating on the tab still being
 *  present in `openTabs` makes every publish from a closed tab a
 *  no-op, so the reset is the final word — no ordering race
 *  (document-unmount publish vs reset write) can lose. */
export function diagnosticsPublishAllowed(
  openTabs: Readonly<Record<string, unknown>>,
  tabId: string,
): boolean {
  return openTabs[tabId] !== undefined;
}