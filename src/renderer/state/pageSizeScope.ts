// TFL-1130 (TFL-1116 DEF-620) - the scope key for the host's live page-size map.
//
// The host keeps `livePageSizes` as a `Record<scopeKey, Map<page, size>>`. Every
// mounted DocumentView publishes the sizes it has measured, and the Inspector's
// Size row reads the entry for the ACTIVE scope.
//
// In Multi Mode the scope is the PANE ("A" / "B"): each pane owns exactly one
// document view and the two panes are independent, so a pane key preserves the
// shipped two-pane behavior.
//
// In single mode every tab is mounted at once (MultiPane renders a
// `.tab-pane` per tab, hidden or not) and every tab passes `pane = null`. A
// shared `"single"` key therefore collides across tabs: the LAST tab to report
// overwrote the map, and a re-activated tab whose measured sizes had not
// changed never re-reported its own map, so the Inspector's Size row kept
// showing the previously-focused tab's geometry (DEF-620). Scope single mode by
// the ACTIVE TAB id instead - the same per-document keying as
// `exportDraft.ts` / `navigatorState.ts` - so each tab's measured geometry is
// stored under its own key and survives a tab-away / tab-back round trip.
//
// PURE: the caller owns the `Record<scopeKey, map>`; this module only derives
// the key, so the wiring is pinned without mounting App.

/** The pane a document view is rendered into, or `null` in single mode. */
export type PageSizeScopePane = string | null;

/** The page-size map key: the pane in Multi Mode, else the tab id. Falls back
 *  to the legacy `"single"` sentinel only when BOTH are null (no open tab, so
 *  no document view is mounted and no entry can exist). */
export function livePageSizeScopeKey(
  pane: PageSizeScopePane,
  tabId: string | null,
): string {
  if (pane !== null) return pane;
  return tabId ?? "single";
}
