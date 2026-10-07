// TFL-1116 C4 (R05) — the ONE surface capability evaluator.
//
// The ACTIVE SURFACE (Home vs a real document) decides which document-only
// commands exist at all. On Home these commands are ABSENT — not merely
// disabled — from the File menu, the application menu and the title-row
// toolbar, and their keyboard routes are no-ops. This module owns the pure
// surface algebra; it touches no React and no electron.
//
// "Home" means there is no document on the active tab. The caller passes the
// existing `activeTabHasDocument` predicate (`App.tsx`), which is already the
// single source of truth for "does the active tab hold an engine session".

/** Which surface the active tab presents: the welcome/home screen or a real
 *  document. */
export type CommandSurface = "home" | "document";

/** Map the active-tab document predicate onto the surface. */
export function deriveCommandSurface(hasActiveDocument: boolean): CommandSurface {
  return hasActiveDocument ? "document" : "home";
}

/** The document-only action ids present in `menuGroups` (`App.tsx`). These are
 *  the rows that must vanish on Home. `Find`, `Print` and `Crop` are not menu
 *  action ids — Find is a relocated manual row and Print/Crop are gated (or
 *  unmounted) elsewhere. */
export const DOCUMENT_ONLY_MENU_ACTIONS: ReadonlySet<string> = new Set([
  "save",
  "saveAs",
  "closeTab",
  "undo",
  "redo",
  "recognizeText",
]);

/** True iff the named menu action is document-only. */
export function isDocumentOnlyMenuAction(action: string | undefined): boolean {
  return action !== undefined && DOCUMENT_ONLY_MENU_ACTIONS.has(action);
}

/** Filter the audited menu group list for the active surface.
 *
 *  On `"home"`: drop every entry whose `action` is document-only, then drop any
 *  group left with zero entries (so an emptied `Tools` group disappears
 *  entirely rather than rendering an empty heading).
 *
 *  On `"document"`: return the INPUT unchanged — the SAME reference — so memo
 *  consumers and reference-equality tests keep their identity. */
export function filterMenuGroupsForSurface<
  T extends { entries: readonly { action?: string }[] },
>(groups: readonly T[], surface: CommandSurface): T[] {
  if (surface === "document") return groups as T[];
  const out: T[] = [];
  for (const group of groups) {
    const entries = group.entries.filter(
      (entry) => !isDocumentOnlyMenuAction(entry.action),
    );
    if (entries.length === 0) continue;
    out.push(entries.length === group.entries.length
      ? group
      : { ...group, entries });
  }
  return out;
}

/** DEF-626 — filter a FLAT entry list (the Command Palette corpus) for the
 *  active surface. The palette is not grouped, so it cannot ride
 *  `filterMenuGroupsForSurface`; this is the same algebra on the flat shape.
 *  On `"home"` every document-only entry is DROPPED (absent, not merely
 *  disabled); on `"document"` the INPUT is returned by reference so memo
 *  consumers and reference-equality tests keep their identity. */
export function filterEntriesForSurface<
  T extends { action?: string },
>(entries: readonly T[], surface: CommandSurface): T[] {
  if (surface === "document") return entries as T[];
  return entries.filter((entry) => !isDocumentOnlyMenuAction(entry.action));
}