// Phase 35 — the ONE renderer open path every "open this file" entry point
// shares: the title-bar Open dialog, a recent-file click, an OS-launched
// PDF path (`app:openPathRequest`) and an OS file drop. The helper owns the
// Multi Mode routing (Phase 32/33): a document opened while Multi Mode is on
// is ASSIGNED to the focused pane, never left as a hidden tab; a file that is
// already the other pane's document is refused up front (the routing object
// shows the message itself).
//
// Kept as a plain function (not a hook) so the routing contract is unit-
// testable without booting App: single mode (routing null) opens and leaves
// the open's own activation standing; Multi Mode calls `show` with the new
// tab id; a refusal stops before any open.

export interface OpenRouting {
  /** Refuse the open when the file is already the other pane's document
   *  (shows the message itself). Returns true when the open must stop. */
  refuseFocused: (filePath: string | null) => boolean;
  /** Assign a freshly opened tab to the FOCUSED pane (Multi Mode only;
   *  single mode is a no-op and the open's own activation stands). */
  show: (tabId: string) => void;
}

/**
 * Open `path` through the app's existing `openPdfFromPath` and route the
 * resulting tab exactly like a dialog open. Returns the opened tab id, or
 * null when the open failed / was refused.
 */
export async function openRequestedPath(
  path: string,
  openPdfFromPath: (path: string) => Promise<string | null>,
  routing: OpenRouting | null,
): Promise<string | null> {
  if (routing !== null && routing.refuseFocused(path)) return null;
  const tabId = await openPdfFromPath(path);
  if (tabId !== null && routing !== null) routing.show(tabId);
  return tabId;
}
