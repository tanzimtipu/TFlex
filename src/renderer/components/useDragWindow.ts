// DEF-140 / DEF-147 — draggable floating windows.
//
// A floating window (inline editor, action bar, note editor, color
// palette popover, dialog) gets a drag handle on its header / chrome:
// a press on the chrome (anything that is NOT a control) records the
// pointer + the window's current viewport rect, a window-level
// pointermove repositions the window through an offset state (applied
// by the caller on top of the anchored position), and pointerup /
// pointercancel end the drag. The window is clamped within the
// viewport so it can never be dragged off-screen.
//
// This hook generalizes the EditInlineEditor DEF-140 drag (which qa
// pinned in def_140_verify_1.7.14.spec.cjs: the window follows the
// cursor MID-DRAG, stays put AFTER release, and presses on actual
// controls never start a move) so every floating context window gets
// the same semantics (DEF-147).
//
// AGENTS.md cross-bubbling rule: the drag starts on `pointerdown`, but
// it only ever stops the event's default (text-selection / native drag
// ghost on chrome). It never calls stopPropagation, and the controls
// selector makes interactive elements' presses fall through
// untouched, so buttons / inputs / selects keep their own behavior.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { clamp } from "../edit/model";

export interface UseDragWindowArgs {
  /** CSS selector matched via `closest()` against the pointerdown
   *  target. A press on any element matching this selector belongs
   *  to that control and never starts a window move (buttons /
   *  inputs / selects / textareas / the color pad / etc.). */
  controlsSelector: string;
  /** Phase 25 — optional ancestor selector for the drag CLAMP. When
   *  set, the window is confined to that ancestor's viewport rect
   *  instead of the whole window, so a surface that floats inside a
   *  panel (the text-properties card over .workspace-main) can never
   *  be dragged out of its area. Unset keeps the original
   *  whole-viewport clamp for every existing caller. */
  clampSelector?: string;
  /** DEF-256 — optional selector of a sibling surface this window must
   *  never be dragged ON TOP OF (the docked Tools palette, which floats
   *  above the page view on the right). At drag start the avoid
   *  element's LIVE viewport rect is read; when it is visible the
   *  window's right edge is capped at that element's left edge minus
   *  `avoidGap`, so the window can still be moved freely anywhere in
   *  the remaining area. A hidden / unmounted avoid element is a no-op,
   *  so the window's behaviour (and its stored offset) is unchanged
   *  whenever the other surface is closed. */
  avoidSelector?: string;
  /** DEF-256 — gutter (CSS px) kept between the window's right edge and
   *  the avoided surface's left edge. Defaults to 0. */
  avoidGap?: number;
}

export interface DragWindowController {
  /** True while a drag is in flight (caller merges a grabbing
   *  class / affordance). */
  dragging: boolean;
  /** Current drag offset in CSS px — the mid-drag VISUAL value
   *  (React state; drives the window's rendered left/top and any
   *  drag affordances). */
  offset: { x: number; y: number };
  /** DEF-151 — the SYNCHRONOUS truth: the latest offset as written
   *  by the pointermove handler, independent of React's render
   *  cycle. COMMIT paths must read this (never the `offset` state,
   *  never an effect-derived value) so a Confirm click that lands
   *  one render behind the final pointermove still commits at the
   *  MOVED position. */
  getOffset: () => { x: number; y: number };
  /** Attach to the WINDOW element. The window's bounding rect at
   *  drag start anchors the clamp. */
  windowRef: (el: HTMLElement | null) => void;
  /** Spread onto the HANDLE element (may be the window itself when
   *  the whole window is chrome-draggable). */
  handleProps: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  };
}

/** Build a drag controller for a floating window. One window per
 *  hook instance — call it once per floating surface. */
export function useDragWindow(args: UseDragWindowArgs): DragWindowController {
  const { controlsSelector, clampSelector, avoidSelector, avoidGap = 0 } = args;
  const windowElRef = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // DEF-151 — the synchronous mirror of `offset`. The pointermove
  // handler writes this ref BEFORE calling `setOffset`, so a commit
  // that runs before React re-renders (the packaged-app race: the
  // Confirm click reads `drag.offset` one render behind the last
  // pointermove and commits dx=0) reads the true moved offset here.
  // `offset` state stays for the mid-drag visual affordance only;
  // it is never the commit source of truth.
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
    viewLeft: number;
    viewTop: number;
    width: number;
    height: number;
    /** Phase 25 — the resolved clamp box in viewport px. Defaults to
     *  the whole viewport; a `clampSelector` ancestor narrows it. */
    minLeft: number;
    minTop: number;
    maxLeft: number;
    maxTop: number;
  } | null>(null);

  const windowRef = useCallback((el: HTMLElement | null): void => {
    windowElRef.current = el;
  }, []);

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>): void => {
      if (e.button !== 0) return; // left button only
      const target = e.target as Element | null;
      // A press on a control belongs to that control (native select
      // dropdown / number spinner / button / textarea / color pad);
      // it must never initiate a window move.
      if (
        target !== null &&
        typeof target.closest === "function" &&
        target.closest(controlsSelector) !== null
      ) {
        return;
      }
      const el = windowElRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      // Phase 25 — resolve the clamp box ONCE at drag start. Default:
      // the whole viewport (the original behaviour). With a
      // `clampSelector` ancestor, the box is that ancestor's viewport
      // rect, so the window stays inside its containing area (pinned
      // to the top/left edge if it is larger than the area).
      let minLeft = 0;
      let minTop = 0;
      let maxLeft = Math.max(0, window.innerWidth - rect.width);
      let maxTop = Math.max(0, window.innerHeight - rect.height);
      if (clampSelector !== undefined && typeof el.closest === "function") {
        const host = el.closest(clampSelector);
        if (host !== null) {
          const b = host.getBoundingClientRect();
          minLeft = b.left;
          minTop = b.top;
          maxLeft = Math.max(minLeft, b.right - rect.width);
          maxTop = Math.max(minTop, b.bottom - rect.height);
        }
      }
      // DEF-256 — never let this window be dragged over the avoided
      // sibling surface (the open Tools palette): its right edge is
      // capped at that surface's left edge minus the gutter. The live
      // rect is read here, at drag start, so a palette created / closed
      // / resized between drags is always honoured. `Math.max(minLeft,
      // ...)` keeps the range non-inverted at widths where the free
      // area is narrower than the window (the window then simply pins
      // to the left edge of its clamp box instead of jumping).
      if (avoidSelector !== undefined) {
        const avoid = document.querySelector(avoidSelector);
        if (avoid !== null) {
          const a = avoid.getBoundingClientRect();
          if (a.width > 0 && a.height > 0) {
            maxLeft = Math.max(minLeft, Math.min(maxLeft, a.left - rect.width - avoidGap));
          }
        }
      }
      // DEF-151 — anchor the drag from the SYNCHRONOUS ref, not the
      // render-closure `offset`: a second drag in the same session
      // must continue from the LIVE position even if the visual
      // state render hasn't committed yet.
      dragRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startOffsetX: offsetRef.current.x,
        startOffsetY: offsetRef.current.y,
        viewLeft: rect.left,
        viewTop: rect.top,
        width: rect.width,
        height: rect.height,
        minLeft,
        minTop,
        maxLeft,
        maxTop,
      };
      setDragging(true);
      // Prevent the browser's text-selection / native drag-ghost while
      // dragging chrome (labels are non-focusable, so no focus or
      // click behavior relies on the default action here). No
      // stopPropagation — the event keeps bubbling so click-outside
      // dismissal / backdrop close logic still sees where it started.
      e.preventDefault();
    },
    [controlsSelector, clampSelector, avoidSelector, avoidGap],
  );

  // While a drag is in flight the window follows the cursor via
  // window-level listeners (so it keeps moving even when the pointer
  // strays off the handle), clamped within the viewport on every move.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (d === null) return;
      const propLeft = d.viewLeft + (e.clientX - d.startClientX);
      const propTop = d.viewTop + (e.clientY - d.startClientY);
      const clampedLeft = clamp(propLeft, d.minLeft, d.maxLeft);
      const clampedTop = clamp(propTop, d.minTop, d.maxTop);
      const next = {
        x: d.startOffsetX + (clampedLeft - d.viewLeft),
        y: d.startOffsetY + (clampedTop - d.viewTop),
      };
      // DEF-151 — write the ref SYNCHRONOUSLY in the pointermove
      // handler (before the state update, in the same call stack), so
      // the commit source of truth never waits on a React render. A
      // Confirm click that fires before this pointermove's re-render
      // commits reads `offsetRef.current` = the moved offset here.
      offsetRef.current = next;
      setOffset(next);
    };
    const onUp = (): void => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // A cancelled pointer (OS gesture steal / window deactivation)
    // must also end the drag so the window never stays stuck in
    // "dragging" state waiting for a pointerup that won't come.
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging]);

  // DEF-151 — stable synchronous accessor for the ref mirror. The
  // callback never changes (reads a ref), so commit handlers can
  // capture it once and always get the live offset at call time.
  const getOffset = useCallback((): { x: number; y: number } => offsetRef.current, []);

  return {
    dragging,
    offset,
    getOffset,
    windowRef,
    handleProps: { onPointerDown: onHandlePointerDown },
  };
}