// Phase 112 (TFL-854, chunk H) — the resizable side-panel handle.
//
// The left navigator (ContextPanel) and the right inspector are resizable and
// their widths persist through AppSettings (`panelLeftWidthPx` /
// `panelRightWidthPx`), driven by App state rather than a fixed stylesheet
// width. This module owns the ONE width contract:
//
//   left  220..320 px, default 240
//   right 260..380 px, default 280
//
// and the keyboard-accessible separator that edits it. The pure helpers are
// exported so the layout contract can be pinned without a DOM, exactly like
// `multiPaneLayout` / `dockFit`.
//
// The handle mirrors the existing `MultiDivider` (MultiPane.tsx) affordance but
// adds the keyboard channel the brief requires (ArrowLeft / ArrowRight nudge,
// Home / End jump to the bounds) and ARIA value semantics
// (role="separator", aria-orientation, aria-valuenow/min/max). Focus is a
// distinct outline, never the text selection.

import { useCallback, useRef, type ReactElement } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { INSPECTOR_COLLAPSED_W_PX } from "../multiPaneLayout";

export type PanelSide = "left" | "right";

export interface PanelWidthRange {
  min: number;
  max: number;
  default: number;
}

/** The left navigator's width band (mirrors the G contract). */
export const PANEL_LEFT_WIDTH: PanelWidthRange = { min: 220, max: 320, default: 240 };
/** The right inspector's width band (mirrors the G contract). */
export const PANEL_RIGHT_WIDTH: PanelWidthRange = { min: 260, max: 380, default: 280 };

/** The collapsed rail width; mirrors `.app-main[data-rail-collapsed="true"]`. */
export const RAIL_COLLAPSED_PX = 48;
/** One keyboard nudge, in CSS pixels. */
export const PANEL_RESIZE_STEP_PX = 16;
/** The fixed Stage Rail column the left handle must clear; mirrors the CSS token. */
export const STAGE_RAIL_W_PX = 72;
/** The document area the panels may never squeeze below at composition time. */
export const MIN_DOCUMENT_WIDTH_PX = 320;

export function panelWidthRange(side: PanelSide): PanelWidthRange {
  return side === "left" ? PANEL_LEFT_WIDTH : PANEL_RIGHT_WIDTH;
}

/** Clamp `value` into the side's band; a non-finite value falls back to the
 *  documented default rather than an out-of-band number. */
export function clampPanelWidth(side: PanelSide, value: number): number {
  const range = panelWidthRange(side);
  if (!Number.isFinite(value)) return range.default;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** The persisted value's effective width: absent / invalid -> the default. */
export function resolvePanelWidth(side: PanelSide, persisted: number | undefined): number {
  return typeof persisted === "number" && Number.isFinite(persisted)
    ? clampPanelWidth(side, persisted)
    : panelWidthRange(side).default;
}

/** A settings-echo application: absent / invalid leaves the local state alone
 *  (the same preserve-if-valid rule as `pagesPanelReducer.sync`). */
export function syncPanelWidth(
  side: PanelSide,
  echoed: number | undefined,
  current: number,
): number {
  return typeof echoed === "number" && Number.isFinite(echoed)
    ? clampPanelWidth(side, echoed)
    : current;
}

/** The width a keyboard key produces, or `null` when the key is not a resize
 *  control. `ArrowRight` moves the boundary right (left panel grows, right
 *  panel shrinks), which is the direction of motion a user expects. */
export function panelWidthAfterKey(
  side: PanelSide,
  current: number,
  key: string,
  step: number = PANEL_RESIZE_STEP_PX,
): number | null {
  const range = panelWidthRange(side);
  switch (key) {
    case "ArrowRight":
      return clampPanelWidth(side, side === "left" ? current + step : current - step);
    case "ArrowLeft":
      return clampPanelWidth(side, side === "left" ? current - step : current + step);
    case "Home":
      return range.min;
    case "End":
      return range.max;
    default:
      return null;
  }
}

/* ---------------------------------------------------------------------------
 * The App composition: resolved widths from the user's preferences + the
 * ladder / book-view collapse signals, clamped so a usable document area
 * remains at narrow viewports.
 * ------------------------------------------------------------------------- */

export interface PanelCompositionInput {
  viewportWidth: number;
  /** The user's persisted rail width, before collapse. */
  railWidthPx: number;
  /** The rail is collapsed (user preference OR the ladder OR book view). */
  railCollapsed: boolean;
  /** The user's persisted inspector width, before collapse. */
  toolsWidthPx: number;
  /** The inspector is collapsed (user preference OR the ladder OR book view). */
  toolsCollapsed: boolean;
  /** A real document is open, so the inspector's inset is live. */
  inspectorOpen: boolean;
}

export interface PanelComposition {
  /** The rail's effective grid width, px. */
  railPx: number;
  /** The inspector's effective width, px. */
  toolsPx: number;
  /** The canvas inset the inspector reserves, px (0 when it is not open). */
  toolsInsetPx: number;
}

/** Clamp the two effective widths so the document column keeps at least
 *  `MIN_DOCUMENT_WIDTH_PX`. The inspector yields first, then the rail, each
 *  floored at its own collapsed width. The persisted preferences are never
 *  rewritten by this clamp. */
export function fitPanelWidths(input: PanelCompositionInput): { railPx: number; toolsPx: number } {
  let rail = input.railCollapsed ? RAIL_COLLAPSED_PX : input.railWidthPx;
  let tools = input.toolsCollapsed ? INSPECTOR_COLLAPSED_W_PX : input.toolsWidthPx;
  if (!Number.isFinite(input.viewportWidth)) return { railPx: rail, toolsPx: tools };
  const budget = input.viewportWidth - STAGE_RAIL_W_PX - MIN_DOCUMENT_WIDTH_PX;
  if (budget <= 0) return { railPx: input.railCollapsed ? RAIL_COLLAPSED_PX : PANEL_LEFT_WIDTH.min, toolsPx: input.toolsCollapsed ? INSPECTOR_COLLAPSED_W_PX : PANEL_RIGHT_WIDTH.min };
  if (rail + tools <= budget) return { railPx: rail, toolsPx: tools };
  const toolsFloor = input.toolsCollapsed ? INSPECTOR_COLLAPSED_W_PX : PANEL_RIGHT_WIDTH.min;
  tools -= Math.min(tools + rail - budget, Math.max(0, tools - toolsFloor));
  const railFloor = input.railCollapsed ? RAIL_COLLAPSED_PX : PANEL_LEFT_WIDTH.min;
  if (rail + tools > budget) rail -= Math.min(rail + tools - budget, Math.max(0, rail - railFloor));
  return { railPx: rail, toolsPx: tools };
}

/** The App's ONE resolved panel composition from the persisted preferences. */
export function resolvePanelComposition(input: PanelCompositionInput): PanelComposition {
  const fitted = fitPanelWidths(input);
  return {
    railPx: fitted.railPx,
    toolsPx: fitted.toolsPx,
    toolsInsetPx: input.inspectorOpen ? fitted.toolsPx : 0,
  };
}

/** The document viewport width Focus Dock centering keys on: the app frame
 *  minus the Stage Rail track, the rail column and the inspector inset. */
export function documentViewportWidth(args: {
  viewportWidth: number;
  railPx: number;
  toolsInsetPx: number;
}): number {
  if (!Number.isFinite(args.viewportWidth)) return 0;
  return Math.max(0, args.viewportWidth - STAGE_RAIL_W_PX - args.railPx - args.toolsInsetPx);
}

/* ---------------------------------------------------------------------------
 * The handle.
 * ------------------------------------------------------------------------- */

export interface PanelResizeHandleProps {
  side: PanelSide;
  /** The panel's current width, px. */
  width: number;
  /** Live width updates while dragging / stepping. */
  onResize: (width: number) => void;
  /** Called once the gesture settles, for the settings write. */
  onCommit: (width: number) => void;
  "data-testid"?: string;
}

const HANDLE_LABEL: Record<PanelSide, string> = {
  left: "Resize navigator panel",
  right: "Resize inspector panel",
};

/**
 * The keyboard-accessible resize separator. Pointer drag updates the width live
 * (rAF-coalesced so a fast drag cannot flood App renders); keyboard nudges and
 * `Home` / `End` commit immediately.
 */
export function PanelResizeHandle(props: PanelResizeHandleProps): ReactElement {
  const { side, width, onResize, onCommit } = props;
  const range = panelWidthRange(side);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<number | null>(null);

  const widthAt = useCallback(
    (clientX: number): number => {
      const drag = dragRef.current;
      if (drag === null) return clampPanelWidth(side, width);
      const delta = clientX - drag.startX;
      return clampPanelWidth(side, side === "left" ? drag.startWidth + delta : drag.startWidth - delta);
    },
    [side, width],
  );

  const flushPending = useCallback((): void => {
    frameRef.current = null;
    if (pendingRef.current !== null) {
      onResize(pendingRef.current);
      pendingRef.current = null;
    }
  }, [onResize]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (e.button !== undefined && e.button !== 0) return;
      dragRef.current = { startX: e.clientX, startWidth: width };
      if (typeof e.currentTarget.setPointerCapture === "function") {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // capture is an optimization; the drag still works without it
        }
      }
      e.preventDefault();
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (dragRef.current === null) return;
      pendingRef.current = widthAt(e.clientX);
      if (frameRef.current === null && typeof requestAnimationFrame === "function") {
        frameRef.current = requestAnimationFrame(flushPending);
      } else if (frameRef.current === null) {
        flushPending();
      }
    },
    [flushPending, widthAt],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (dragRef.current === null) return;
      const next = widthAt(e.clientX);
      dragRef.current = null;
      pendingRef.current = null;
      if (frameRef.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      onResize(next);
      onCommit(next);
    },
    [onCommit, onResize, widthAt],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      const next = panelWidthAfterKey(side, width, e.key);
      if (next === null) return;
      e.preventDefault();
      onResize(next);
      onCommit(next);
    },
    [onCommit, onResize, side, width],
  );

  return (
    <div
      className="panel-resize-handle"
      data-panel-resize={side}
      data-testid={props["data-testid"]}
      role="separator"
      aria-orientation="vertical"
      aria-label={HANDLE_LABEL[side]}
      aria-valuenow={Math.round(width)}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <span className="panel-resize-grip" aria-hidden="true" />
    </div>
  );
}


