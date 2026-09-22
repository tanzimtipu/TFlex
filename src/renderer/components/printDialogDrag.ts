// Phase 33 — movable print dialog: the pure drag mathematics.
//
// The dialog's shell carries a `translate3d` offset (its OWN CSS transform,
// separate from the dialog surface's enter/exit motion transform, so the two
// never fight). A drag starts on the header, and every pointermove recomputes
// the offset from the geometry captured AT DRAG START, clamped so the dialog
// can never leave the viewport at any extreme. Keeping the maths pure makes
// the clamp invariants unit-testable without a live pointer.

export interface DragRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DragOffset {
  x: number;
  y: number;
}

export interface DragViewport {
  width: number;
  height: number;
}

/** Everything captured when the header press begins a drag. */
export interface DragAnchor {
  /** The shell offset at drag start (its current translate3d). */
  offset: DragOffset;
  /** The dialog's viewport rect at drag start — INCLUDES `offset`. */
  rect: DragRect;
  /** The pointer position at drag start. */
  pointer: DragOffset;
  viewport: DragViewport;
}

export interface DragRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Clamp `value` into `[lo, hi]`. */
export function clampDragValue(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * The shell-offset range that keeps the dialog fully inside the viewport.
 * The bounds are expressed in the SAME space as `anchor.offset` (the shell
 * transform), derived from the dialog's rect at drag start:
 *   - left edge  reaches 0              -> x = offset.x - rect.left
 *   - right edge reaches viewport width -> x = offset.x + (width - rect.right)
 * A dialog wider/taller than the viewport yields an inverted (empty) range;
 * `Math.max` pins it to the min edge instead of jumping.
 */
export function dialogDragRange(anchor: DragAnchor): DragRange {
  const minX = anchor.offset.x - anchor.rect.left;
  const minY = anchor.offset.y - anchor.rect.top;
  const maxX = anchor.offset.x + (anchor.viewport.width - anchor.rect.right);
  const maxY = anchor.offset.y + (anchor.viewport.height - anchor.rect.bottom);
  return {
    minX,
    maxX: Math.max(minX, maxX),
    minY,
    maxY: Math.max(minY, maxY),
  };
}

/** The clamped shell offset for a pointer at (`pointerX`, `pointerY`). */
export function nextDragOffset(
  anchor: DragAnchor,
  pointerX: number,
  pointerY: number,
): DragOffset {
  const range = dialogDragRange(anchor);
  return {
    x: clampDragValue(
      anchor.offset.x + (pointerX - anchor.pointer.x),
      range.minX,
      range.maxX,
    ),
    y: clampDragValue(
      anchor.offset.y + (pointerY - anchor.pointer.y),
      range.minY,
      range.maxY,
    ),
  };
}

/**
 * Re-clamp an existing shell offset against the LIVE viewport and the
 * dialog's CURRENT rect (DEF-283).
 *
 * `dialogRect` is the dialog's viewport rect AT `offset` (i.e. what
 * `getBoundingClientRect()` reports right now, transform included). The
 * panel's offset-0 rect is `rect - offset`, so the same bounds algebra as
 * `dialogDragRange` applies; the only difference is that no drag anchor is
 * involved. A viewport smaller than the panel yields an inverted range and
 * `Math.max` pins the offset to the min edge, exactly like the drag path —
 * the panel can never be pushed to a negative/absurd offset.
 */
export function clampDragOffset(
  offset: DragOffset,
  dialogRect: DragRect,
  viewport: DragViewport,
): DragOffset {
  const range = dialogDragRange({
    offset,
    rect: dialogRect,
    pointer: offset,
    viewport,
  });
  return {
    x: clampDragValue(offset.x, range.minX, range.maxX),
    y: clampDragValue(offset.y, range.minY, range.maxY),
  };
}

/** The dialog's rect move out of the viewport at an offset, for assertions. */
export function dialogRectAt(anchor: DragAnchor, offset: DragOffset): DragRect {
  const dx = offset.x - anchor.offset.x;
  const dy = offset.y - anchor.offset.y;
  return {
    left: anchor.rect.left + dx,
    top: anchor.rect.top + dy,
    right: anchor.rect.right + dx,
    bottom: anchor.rect.bottom + dy,
  };
}