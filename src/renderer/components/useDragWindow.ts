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
}

export interface DragWindowController {
  /** True while a drag is in flight (caller merges a grabbing
   *  class / affordance). */
  dragging: boolean;
  /** Current drag offset in CSS px. The caller applies it on top
   *  of the window's anchored position (left/top or translate). */
  offset: { x: number; y: number };
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
  const { controlsSelector } = args;
  const windowElRef = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
    viewLeft: number;
    viewTop: number;
    width: number;
    height: number;
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
      dragRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startOffsetX: offset.x,
        startOffsetY: offset.y,
        viewLeft: rect.left,
        viewTop: rect.top,
        width: rect.width,
        height: rect.height,
      };
      setDragging(true);
      // Prevent the browser's text-selection / native drag-ghost while
      // dragging chrome (labels are non-focusable, so no focus or
      // click behavior relies on the default action here). No
      // stopPropagation — the event keeps bubbling so click-outside
      // dismissal / backdrop close logic still sees where it started.
      e.preventDefault();
    },
    [controlsSelector, offset],
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
      const maxLeft = Math.max(0, window.innerWidth - d.width);
      const maxTop = Math.max(0, window.innerHeight - d.height);
      const clampedLeft = clamp(propLeft, 0, maxLeft);
      const clampedTop = clamp(propTop, 0, maxTop);
      setOffset({
        x: d.startOffsetX + (clampedLeft - d.viewLeft),
        y: d.startOffsetY + (clampedTop - d.viewTop),
      });
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

  return {
    dragging,
    offset,
    windowRef,
    handleProps: { onPointerDown: onHandlePointerDown },
  };
}