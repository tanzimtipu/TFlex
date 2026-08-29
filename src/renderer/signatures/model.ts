// Signatures state + placement geometry.
//
// The renderer keeps:
//   - The saved-signature list (one per user, persisted via the engine
//     signature service; the renderer mirrors it locally so the manager
//     modal can render synchronously and the stub path still works).
//   - The set of placements on the active tab. Placements live in the
//     engine state (round-tripped like annotations) but the renderer
//     also keeps a working draft for "drag to move / drag to resize".
//
// All coordinates are in PAGE POINTS with a TOP-LEFT origin.

import type {
  SavedSignature,
  SignaturePlacement,
  SignatureSource,
} from "../../shared/types";

// ---------------------------------------------------------------------------
// Saved signatures state

export interface SignaturesState {
  /** Full saved-signature list. The UI shows a "saved" tab listing this. */
  saved: SavedSignature[];
  /** True once the engine (or stub) has populated the list. */
  loaded: boolean;
}

export const initialSignaturesState: SignaturesState = {
  saved: [],
  loaded: false,
};

/** Replace the saved list wholesale. Called after every list / save /
 *  delete round-trip so the local mirror stays in sync with the service. */
export function setSavedList(list: readonly SavedSignature[]): SignaturesState {
  return { saved: [...list], loaded: true };
}

// ---------------------------------------------------------------------------
// Placement geometry (pure)

export interface PagePoint {
  x: number;
  y: number;
}

export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Resize a placement by dragging the corner identified by `handle`.
 *  `handle` is one of "nw" / "ne" / "sw" / "se". The function is the pure
 *  geometry the placement overlay uses during a pointer drag. */
export function resizePlacement(
  rect: PageRect,
  handle: "nw" | "ne" | "sw" | "se",
  delta: PagePoint,
): PageRect {
  let { x, y, width, height } = rect;
  // Clamp so the rect can never collapse to zero or negative — a signature
  // with width 0 has no visible footprint and the placement overlay can't
  // show its resize handles.
  const MIN = 12;
  switch (handle) {
    case "nw":
      x = rect.x + delta.x;
      y = rect.y + delta.y;
      width = rect.width - delta.x;
      height = rect.height - delta.y;
      if (width < MIN) {
        x = rect.x + rect.width - MIN;
        width = MIN;
      }
      if (height < MIN) {
        y = rect.y + rect.height - MIN;
        height = MIN;
      }
      break;
    case "ne":
      y = rect.y + delta.y;
      width = rect.width + delta.x;
      height = rect.height - delta.y;
      if (width < MIN) width = MIN;
      if (height < MIN) {
        y = rect.y + rect.height - MIN;
        height = MIN;
      }
      break;
    case "sw":
      x = rect.x + delta.x;
      width = rect.width - delta.x;
      height = rect.height + delta.y;
      if (width < MIN) {
        x = rect.x + rect.width - MIN;
        width = MIN;
      }
      if (height < MIN) height = MIN;
      break;
    case "se":
      width = rect.width + delta.x;
      height = rect.height + delta.y;
      if (width < MIN) width = MIN;
      if (height < MIN) height = MIN;
      break;
  }
  return { x, y, width, height };
}

/** Translate a placement by a delta (move drag). Pure. */
export function movePlacement(rect: PageRect, delta: PagePoint): PageRect {
  return {
    x: rect.x + delta.x,
    y: rect.y + delta.y,
    width: rect.width,
    height: rect.height,
  };
}

/** Clamp a placement rect so it stays entirely inside the page bounds.
 *  Called on pointer-up after a move / resize so a user can't drag the
 *  signature off the page and lose it. */
export function clampPlacementToPage(
  rect: PageRect,
  pageWidthPt: number,
  pageHeightPt: number,
): PageRect {
  const x = Math.max(0, Math.min(rect.x, pageWidthPt - rect.width));
  const y = Math.max(0, Math.min(rect.y, pageHeightPt - rect.height));
  return { x, y, width: rect.width, height: rect.height };
}

/** Build a default 1.4 inch × 0.5 inch placement anchored at (x, y) — the
 *  size of a typical signature line on a US-letter page. */
export function defaultPlacementRect(at: PagePoint): PageRect {
  return { x: at.x, y: at.y, width: 100, height: 36 };
}

/** Replace the placement set wholesale (round-trip from the engine). */
export function replacePlacements(
  list: readonly SignaturePlacement[],
): SignaturePlacement[] {
  return [...list];
}

/** Whether a saved signature is empty / unrenderable. Used to disable
 *  the "Place" button on a stub signature with no drawn points / text. */
export function signatureIsEmpty(s: SavedSignature): boolean {
  if (s.source.kind === "drawn") {
    return s.source.points.length === 0
      || s.source.points.every((p) => p.length === 0);
  }
  return s.source.text.trim().length === 0;
}

/** Display label for a saved signature. Trims typed text; falls back to
 *  the auto-generated "Signature N" name for drawn signatures. */
export function signatureLabel(s: SavedSignature): string {
  if (s.source.kind === "typed") {
    const t = s.source.text.trim();
    return t.length > 0 ? t : s.label;
  }
  return s.label;
}

/** Derive a sensible default label for a freshly captured signature. */
export function defaultSignatureLabel(source: SignatureSource, index: number): string {
  if (source.kind === "typed") {
    const t = source.text.trim();
    if (t.length > 0) return t.length > 32 ? `${t.slice(0, 32)}…` : t;
  }
  return `Signature ${index + 1}`;
}