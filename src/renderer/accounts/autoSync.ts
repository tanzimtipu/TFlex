// Phase 51 (item 2 / feature B) — AUTOMATIC SYNC triggers.
//
// The operator asked for syncing to happen automatically on sign-in, on
// signature add/delete, and on any settings change — with the manual "Sync now"
// control kept only as a BACKUP. There is no new sync mechanism here: every
// trigger funnels into the EXISTING coordinator through the one renderer-facing
// entry the preload exposes, `accounts:syncNow` (single-flight + never
// rejects). The coordinator already:
//   - debounces the settings-write path (main calls `requestSync()` from the
//     settings broadcast), and
//   - guards the network: no token / `accountsEnabled` off / no transport all
//     resolve to a non-network report (see `AccountsSyncEngine.sync`).
//
// This module only decides WHEN to ask. It refuses to ask while the user is
// signed out so a mutation does not broadcast a spurious "Not synced yet"
// report; the coordinator's own guard is the second line of defence.
//
// Trigger inventory (what requests a sync now):
//   1. sign-in completion (password flow, after the session is stored)
//   2. Google sign-in completion (main has already stored the session)
//   3. saved-signature add (draw / type)   -> SignatureManagerModal
//   4. saved-signature delete              -> SignatureManagerModal
//   5. any settings change                 -> main settings broadcast (existing)
//   6. the manual "Sync now" control       -> AccountsDialog / AccountMenu

import { accountsBridge, type AccountsBridge } from "./bridge";

export interface RequestAutoSyncOptions {
  /** True only when the account session is live. The coordinator guards too,
   *  but skipping while signed out avoids a no-op report on every mutation. */
  signedIn: boolean;
  /** Injectable for tests; defaults to the preload bridge. */
  bridge?: AccountsBridge | null;
}

/** Ask the existing coordinator for a sync. Never throws; a missing bridge
 *  (unconfigured install) is a silent no-op, exactly like the manual control. */
export function requestAutoSync(options: RequestAutoSyncOptions): void {
  if (!options.signedIn) return;
  const api = options.bridge === undefined ? accountsBridge() : options.bridge;
  if (api === null) return;
  void api.syncNow().catch(() => undefined);
}
