// OTA UX — Bug 9: host-side update prompt state machine.
//
// The backend owns the download lifecycle (electron-updater); this
// module owns the *presentation* decisions the App host must make
// around the UpdatePromptDialog:
//
//   available -> (click Update) -> downloading (dismiss to background
//   + toolbar indicator progress) -> downloaded -> restart / cancel
//   prompt.
//
// Two facts keep these decisions pure and unit-testable:
//   1. `decideUpdatePromptOpen` answers "should the dialog auto-open
//      for this incoming state, given what is already open, whether
//      a download is running in the background, and whether the
//      user just dismissed a prompt?" — App calls it whenever a
//      state push arrives (and whenever the dialog closes).
//   2. `updateActionableKey` gives each actionable state a stable
//      identity so a prompt the user dismissed is not re-shown for
//      the *same* state (they can still act via the toolbar), while
//      a *different* state (available -> downloaded) always opens a
//      fresh prompt.

import type { UpdateState } from "../../shared/types";

/** The two UpdateState kinds that warrant a prompt at all. */
export type UpdatePromptActionableKind = "available" | "downloaded";

type ActionableState = Extract<
  UpdateState,
  { kind: UpdatePromptActionableKind }
>;

/** True when a state warrants a prompt. Narrowing helper so the
 *  switch below sees a concrete union. */
export function isUpdatePromptActionable(
  state: UpdateState | null | undefined,
): state is ActionableState {
  if (state === null || state === undefined) return false;
  return state.kind === "available" || state.kind === "downloaded";
}

/** Stable identity of an actionable prompt so "dismissed" means
 *  "dismissed for THIS version's prompt", not all future prompts. */
export function updateActionableKey(state: ActionableState): string {
  return `${state.kind}:${state.version}`;
}

export interface UpdatePromptOpenDecision {
  /** True when the host should open the prompt for this state. */
  shouldOpen: boolean;
  /** Identity of the state that produced the decision, when
   *  actionable. The host records this as "last shown" so a user
   *  dismiss doesn't cause the same state to re-prompt. */
  key: string | null;
}

export interface UpdatePromptOpenContext {
  /** The incoming backend state. */
  state: UpdateState | null | undefined;
  /** Whether the dialog is currently open. */
  open: boolean;
  /** True from the moment the user clicks Update until the download
   *  reaches a terminal state. The guard that stops a lingering
   *  `available` push from re-arming the "Update" prompt while a
   *  download runs in the background (Bug 9). */
  downloadInFlight: boolean;
  /** Key of the last actionable state the user dismissed (Cancel /
   *  Later / X / backdrop). When the incoming state matches, the
   *  dialog stays dismissed for it. */
  dismissedKey: string | null;
}

/** Decide whether the host should open the update prompt for the
 *  given state + context. Pure: same inputs, same decision.
 *  Exported for unit tests (Bug 9: an outside-click during a
 *  background download must NOT re-arm the 'available' prompt; a
 *  completed download MUST show the restart/cancel prompt). */
export function decideUpdatePromptOpen(
  ctx: UpdatePromptOpenContext,
): UpdatePromptOpenDecision {
  // `ctx.state` is a property access on a const parameter, so TS
  // narrows it through the type guard below — keep referencing
  // `ctx.state` directly (destructuring would drop the narrowing).
  if (!isUpdatePromptActionable(ctx.state)) {
    return { shouldOpen: false, key: null };
  }
  const key = updateActionableKey(ctx.state);
  // The dialog already shows this prompt — no change needed.
  if (ctx.open) return { shouldOpen: false, key };
  switch (ctx.state.kind) {
    case "available":
      // Fresh availability is a prompt *before* the user acts. If a
      // download is already running in the background (the user
      // clicked Update and the popup went away), do NOT re-show the
      // Update prompt — the toolbar indicator owns the progress now.
      // Only arm an 'available' prompt when nothing is being
      // downloaded and this exact prompt hasn't already been
      // dismissed.
      if (ctx.downloadInFlight) return { shouldOpen: false, key };
      return { shouldOpen: ctx.dismissedKey !== key, key };
    case "downloaded":
      // Download complete: always offer the restart prompt unless
      // the user just dismissed this exact one (Later / X).
      return { shouldOpen: ctx.dismissedKey !== key, key };
    default:
      return { shouldOpen: false, key };
  }
}
