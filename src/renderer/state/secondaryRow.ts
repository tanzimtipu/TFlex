// Phase 37 (item 3) — the secondary tool surface's ladder.
//
// After a tool is picked from the Action Dock the matching secondary surface
// appears: an annotation tool -> the AnnotationFlyout, an edit tool -> the
// EditToolbar. REQUIREMENTS.md rules that surface renders as ONE ROW with NO
// header and follows the SAME responsive ladder as the dock (E): hide the
// labels first, then show left/right arrows to scroll the row. Neither the
// dock nor this row may ever stack.
//
// The ladder is NOT re-derived here. The host resolves the one DockLadder from
// the measured workspace width (chunk 3) and hands it to both surfaces, so the
// dock and the secondary row shed chrome at exactly the same widths. This
// module only names the two rungs the secondary row consumes, which keeps the
// contract unit-testable without a DOM.

import type { DockLadder } from './dockResponsive';

/** The two dock rungs a secondary row consumes. */
export interface SecondaryRowLadder {
  /** Rung 3 — hide the row's text labels. */
  iconOnly: boolean;
  /** Rung 4 — shrink the row and scroll it with left/right arrows. */
  arrows: boolean;
}

/**
 * Project the shared dock ladder onto the secondary row. A mount that has not
 * been handed a ladder (older harnesses) renders the full, labelled row.
 */
export function resolveSecondaryRowLadder(
  ladder: DockLadder | undefined,
): SecondaryRowLadder {
  return {
    iconOnly: ladder?.iconOnly ?? false,
    arrows: ladder?.arrows ?? false,
  };
}
