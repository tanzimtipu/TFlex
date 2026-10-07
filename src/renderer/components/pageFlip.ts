// Phase 114 (chunk A) — the page-flip transition engine core.
//
// ONE engine for every page turn. A turn (next / prev) re-lays-out the
// PAPER-OWNING page unit (`.page-slot`, the same unit the zoom FLIP animates —
// see zoomFlip.ts) instantly, and the engine then plays a one-shot
// compositor-only entrance from the turn direction back to rest:
//
//   - `pageFlipDecision` decides WHETHER a turn animates (only the single-page
//     and facing reading modes animate, and only when motion is not instant).
//   - `pageFlipTravel` maps a direction to a start translate in px.
//   - `applyPageFlip` writes the start values as CSS custom properties, forces
//     one reflow, then adds `PAGE_FLIP_CLASS` — mirroring `applyZoomFlip`.
//   - `clearPageFlip` removes the class and the vars.
//   - `isPageFlipEnd` filters `animationend` to the unit's OWN animation.
//
// The class/keyframe live in styles.css and are collapsed by the global
// reduced-motion / `:root[data-animations="off"]` catch-alls; the React binding
// (usePageFlipTransition) additionally skips the class entirely on the instant
// path. Transform + opacity only, so the PDF bitmap is never recoloured and the
// turn composites.

import { MOTION_TRANSLATE } from "../hooks/motionTokens";

/** Which reading mode the canvas is in. Only `single` and `facing` (a
 *  two-page spread) animate a page turn; `grid` and `continuous` scroll land
 *  the new page instantly. */
export type PageFlipMode = "single" | "facing" | "grid" | "continuous";

/** The direction of a page turn. `none` is the explicit no-op value. */
export type PageFlipDirection = "next" | "prev" | "none";

/** The decision core's answer: play the compositor animation, or land the
 *  new page instantly. */
export type PageFlipDecision = "animate" | "instant";

/** The class the applier toggles for the one-shot page-flip animation. The
 *  matching `tf-page-flip` keyframe lives in styles.css. */
export const PAGE_FLIP_CLASS = "tf-page-flip";

/** The keyframe name, mirrored from styles.css so `animationend` can be
 *  filtered to THIS animation. */
export const PAGE_FLIP_ANIMATION = "tf-page-flip";

/** The custom properties the keyframe reads as its `from` translate, in px. */
export const PAGE_FLIP_DX_VAR = "--tf-page-flip-dx";
export const PAGE_FLIP_DY_VAR = "--tf-page-flip-dy";

/** The page-turn travel distance in px, from the shared motion token
 *  (`--motion-translate-panel`, 24). Every animating mode uses the same
 *  distance so the motion reads as one engine. */
const TRAVEL_PX = MOTION_TRANSLATE.panel;

/** The latest-wins turn request. `key` strictly increases across requests so
 *  a consumer can tell a newer turn from a stale one. */
export interface PendingPageFlip {
  page: number;
  dir: PageFlipDirection;
  key: number;
}

/** Returns `"animate"` ONLY for a real navigation turn in a single or facing
 *  reading mode while motion is not instant; every other combination is
 *  `"instant"`. */
export function pageFlipDecision(args: {
  mode: PageFlipMode;
  instant: boolean;
  navigation: boolean;
}): PageFlipDecision {
  if (args.navigation && !args.instant && (args.mode === "single" || args.mode === "facing")) {
    return "animate";
  }
  return "instant";
}

/** The start translate for a turn. `next` travels in from +X, `prev` from
 *  -X, `none` does not move. `mode` does not change the travel — the gating
 *  in `pageFlipDecision` decides whether a turn animates at all. */
export function pageFlipTravel(
  mode: PageFlipMode,
  dir: PageFlipDirection,
): { dx: number; dy: number } {
  void mode;
  if (dir === "next") {
    return { dx: TRAVEL_PX, dy: 0 };
  }
  if (dir === "prev") {
    return { dx: -TRAVEL_PX, dy: 0 };
  }
  return { dx: 0, dy: 0 };
}

/** Latest-wins coalescing: always returns `next`, with `key` strictly
 *  increasing (one past `current` when a request is already pending). At most
 *  one turn is ever pending. */
export function nextPendingFlip(
  current: PendingPageFlip | null,
  next: PendingPageFlip,
): PendingPageFlip {
  const key = current === null ? next.key : current.key + 1;
  return { ...next, key };
}

function clearPageFlipVars(el: HTMLElement): void {
  el.style.removeProperty(PAGE_FLIP_DX_VAR);
  el.style.removeProperty(PAGE_FLIP_DY_VAR);
}

/** Stop and erase any page-flip animation currently applied to `el`. */
export function clearPageFlip(el: HTMLElement): void {
  el.classList.remove(PAGE_FLIP_CLASS);
  clearPageFlipVars(el);
}

/** Apply the turn as a one-shot animation on `el`: clears any in-flight flip
 *  first, writes both start vars from `pageFlipTravel`, forces one reflow,
 *  then adds `PAGE_FLIP_CLASS` so a second turn restarts instead of being
 *  swallowed. Returns false when `instant` or `dir === "none"` (and still
 *  clears). */
export function applyPageFlip(
  el: HTMLElement,
  dir: PageFlipDirection,
  instant: boolean,
): boolean {
  clearPageFlip(el);
  if (instant || dir === "none") {
    return false;
  }
  const travel = pageFlipTravel("single", dir);
  el.style.setProperty(PAGE_FLIP_DX_VAR, `${Number(travel.dx.toFixed(4))}px`);
  el.style.setProperty(PAGE_FLIP_DY_VAR, `${Number(travel.dy.toFixed(4))}px`);
  void el.offsetWidth;
  el.classList.add(PAGE_FLIP_CLASS);
  return true;
}

/** True when `e` is the END of the unit's OWN page-flip — same animation name
 *  AND fired by the unit itself. Nested overlays bubble `animationend` up, so
 *  the target check keeps a descendant's animation from clearing the flip
 *  early. */
export function isPageFlipEnd(
  e: { animationName: string; target: EventTarget | null },
  unit: HTMLElement,
): boolean {
  return e.animationName === PAGE_FLIP_ANIMATION && e.target === unit;
}
