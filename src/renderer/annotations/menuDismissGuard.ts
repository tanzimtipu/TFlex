// Phase 19 / DEF-227 (ADV-046) — one-shot guard for the annotation
// tools menu dismiss gesture.
//
// The all-tools menu closes on any pointerdown outside the toggle and
// the menu itself. That same pointerdown also reaches the page's
// AnnotationOverlay (React listens at the root, deeper in the tree),
// so before this guard a single click both dismissed the menu AND
// started the armed tool's placement gesture (a sticky-note editor
// opened, a rect drag committed).
//
// The toolbar's outside-dismiss handler runs at window CAPTURE phase
// (it must, so it is reached before the overlay's React handler) and
// marks the EXACT native event that dismissed the menu. The overlay
// asks `consumeMenuDismissPointer(e.nativeEvent)` at the top of its
// pointerdown path: a match means "this pointerdown only dismissed the
// menu" and the overlay returns without placing; any other event never
// matches, so a later gesture is untouched.
//
// Matching by event identity (not a bare boolean) is deliberate: a
// dismissing pointerdown on a CommandBar button never reaches the
// overlay, and a boolean would stay armed and swallow the NEXT page
// gesture. Identity cannot misfire and needs no timer.
//
// No preventDefault / stopPropagation is used anywhere in this path —
// AGENTS.md cross-bubbling rules. The click still completes for
// CommandBar buttons and the text layer.

let dismissingEvent: Event | null = null;

/** Marks the native pointerdown that just dismissed the tools menu. */
export function markMenuDismissPointer(nativeEvent: Event): void {
  dismissingEvent = nativeEvent;
}

/** Returns true when this exact pointerdown dismissed the tools menu,
 *  and clears the mark so it can only consume one gesture. */
export function consumeMenuDismissPointer(nativeEvent: Event): boolean {
  if (dismissingEvent === null || dismissingEvent !== nativeEvent) return false;
  dismissingEvent = null;
  return true;
}

/** Test-only reset; also keeps the retained reference from outliving
 *  the interaction in long-lived sessions. */
export function clearMenuDismissPointer(): void {
  dismissingEvent = null;
}
