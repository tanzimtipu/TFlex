// Per-page signature placement overlay.
//
// Renders every SignaturePlacement for the page and hosts the move /
// resize / delete interactions:
//   - Click anywhere inside a placement (not on a handle) -> select it
//     so the resize handles appear and Delete-key removes it.
//   - Drag the body -> move (calls engine.moveSignature on pointerup).
//   - Drag a corner handle -> resize.
//   - Delete key when a placement is selected -> engine.deleteSignature.
//
// While the Sign tool is active in the toolbar, the overlay also shows a
// ghost placement that follows the cursor and places a new signature on
// click (driven by the App-level signature manager modal selecting a
// saved signature and arming the tool).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type {
  SavedSignature,
  SignaturePlacement,
} from "../../shared/types";
import {
  clampPlacementToPage,
  movePlacement,
  resizePlacement,
} from "./model";
import { DRAW_PEN_COLOR, DRAW_PEN_WIDTH } from "./canvas";

// Default size (in page points) for the ghost preview + the new
// placement when the user clicks with a signature tool armed. The
// width / height match what the click handler already uses for the
// actual placement, so the cursor preview is exactly the same size
// as the placement it creates on click (Bug 11: transparent cursor
// preview when placing sign/stamp).
export const SIGNATURE_GHOST_WIDTH_PT = 64;
export const SIGNATURE_GHOST_HEIGHT_PT = 22;

export type SignatureDragMode =
  | { kind: "move"; origin: { x: number; y: number }; startRect: SignaturePlacement["rect"] }
  | { kind: "resize"; origin: { x: number; y: number }; startRect: SignaturePlacement["rect"]; handle: "nw" | "ne" | "sw" | "se" };

interface SignaturesOverlayProps {
  page: number;
  pageWidthPt: number;
  pageHeightPt: number;
  cssScale: number;
  placements: SignaturePlacement[];
  /** Saved signatures keyed by id, so we can render the right raster. */
  signatures: Record<string, SavedSignature>;
  /** When set, a ghost placement follows the cursor and a click places
   *  a new signature (Sign tool). */
  armedSignatureId: string | null;
  onPlace: (sigId: string, rect: SignaturePlacement["rect"]) => void;
  onMove: (placementId: string, rect: SignaturePlacement["rect"]) => void;
  onDelete: (placementId: string) => void;
}

export function SignaturesOverlay(props: SignaturesOverlayProps): ReactElement | null {
  const {
    page,
    pageWidthPt,
    pageHeightPt,
    cssScale,
    placements,
    signatures,
    armedSignatureId,
    onPlace,
    onMove,
    onDelete,
  } = props;
  const pagePlacements = useMemo(
    () => placements.filter((p) => p.page === page),
    [placements, page],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragRef = useRef<SignatureDragMode | null>(null);
  // Layer root ref. The ghost-cursor pointermove effect needs
  // the layer's bounding rect to translate client coords into
  // page points (Bug 11).
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Bug 11 — pointer-driven ghost preview. When a signature is
  // armed we track the cursor's page-space position and render a
  // translucent rectangle at that position so the user can see
  // exactly where the placement will land before they click.
  const [ghostPt, setGhostPt] = useState<{ x: number; y: number } | null>(null);
  // Bug 2 — pending placement. After the user clicks with a
  // signature armed, the placement is held in local state with an
  // action bar (confirm / cancel / delete) above the rect. The user
  // commits via Confirm; the rect is removed on either Cancel or
  // Delete. The placement only enters the engine on Confirm, so a
  // quick accidental click can be undone without modifying the doc.
  const [pendingPlacement, setPendingPlacement] = useState<{
    rect: SignaturePlacement["rect"];
    signatureId: string;
  } | null>(null);

  // Drop the selection when the page changes — no point keeping a
  // selection across pages.
  useEffect(() => {
    setSelectedId(null);
  }, [page]);

  // Esc clears the selection; Delete removes it. Escape also drops
  // a pending (uncommitted) placement so the user can dismiss a
  // mid-air placement without committing it (Bug 2).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        if (pendingPlacement !== null) {
          setPendingPlacement(null);
          return;
        }
        if (selectedId === null) return;
        setSelectedId(null);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId === null) return;
        e.preventDefault();
        onDelete(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, onDelete, pendingPlacement]);

  // Bug 11 — listen for pointer moves over the page while a
  // signature is armed so the ghost preview follows the cursor.
  // We use a window-level pointermove listener (same pattern the
  // edit-overlay's text-run hover uses) so the ghost stays accurate
  // even when the cursor moves between pointer events over the
  // overlay's children. The listener only does work while armed;
  // when disarmed it stops adding entries to ghostPt and React
  // stops rendering the preview.
  useEffect(() => {
    if (armedSignatureId === null) {
      setGhostPt(null);
      return;
    }
    const layer = rootRef.current;
    if (layer === null) return;
    const onMove = (e: PointerEvent): void => {
      const rect = layer.getBoundingClientRect();
      const x = (e.clientX - rect.left) / cssScale;
      const y = (e.clientY - rect.top) / cssScale;
      // Only update the ghost when the cursor is inside the page
      // bounds; otherwise we keep the last on-page position so the
      // preview doesn't snap to (0,0) when the user moves the
      // cursor over a sibling panel.
      if (
        x < 0 ||
        y < 0 ||
        x > pageWidthPt ||
        y > pageHeightPt
      ) {
        return;
      }
      setGhostPt({ x, y });
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [armedSignatureId, cssScale, pageWidthPt, pageHeightPt]);

  const onPointerDownPlacement = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      placement: SignaturePlacement,
      handle?: "nw" | "ne" | "sw" | "se",
    ): void => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      setSelectedId(placement.id);
      dragRef.current = {
        kind: handle === undefined ? "move" : "resize",
        origin: { x: e.clientX, y: e.clientY },
        startRect: { ...placement.rect },
        ...(handle !== undefined ? { handle } : {}),
      } as SignatureDragMode;
    },
    [],
  );

  const onPointerMovePlacement = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current;
      if (drag === null) return;
      const dx = (e.clientX - drag.origin.x) / cssScale;
      const dy = (e.clientY - drag.origin.y) / cssScale;
      if (drag.kind === "move") {
        const next = movePlacement(drag.startRect, { x: dx, y: dy });
        // Live preview only — the engine sees the move on pointerup. We
        // mutate the local rect via a CSS transform so the user sees a
        // smooth drag, not a step per frame.
        const target = e.currentTarget;
        target.style.transform = `translate(${dx * cssScale}px, ${dy * cssScale}px)`;
        void next;
      } else {
        const next = resizePlacement(drag.startRect, drag.handle, { x: dx, y: dy });
        const target = e.currentTarget;
        target.style.width = `${next.width * cssScale}px`;
        target.style.height = `${next.height * cssScale}px`;
      }
    },
    [cssScale],
  );

  const onPointerUpPlacement = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, placement: SignaturePlacement): void => {
      const drag = dragRef.current;
      if (drag === null) return;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      const dx = (e.clientX - drag.origin.x) / cssScale;
      const dy = (e.clientY - drag.origin.y) / cssScale;
      const target = e.currentTarget;
      target.style.transform = "";
      target.style.width = `${drag.startRect.width * cssScale}px`;
      target.style.height = `${drag.startRect.height * cssScale}px`;
      let nextRect: SignaturePlacement["rect"];
      if (drag.kind === "move") {
        nextRect = clampPlacementToPage(movePlacement(drag.startRect, { x: dx, y: dy }), pageWidthPt, pageHeightPt);
      } else {
        nextRect = clampPlacementToPage(resizePlacement(drag.startRect, drag.handle, { x: dx, y: dy }), pageWidthPt, pageHeightPt);
      }
      dragRef.current = null;
      onMove(placement.id, nextRect);
    },
    [cssScale, onMove, pageWidthPt, pageHeightPt],
  );

  const onGhostClick = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (armedSignatureId === null) return;
      // Bug 2 — pending placement. Clicking with the signature
      // tool armed no longer commits straight to the engine. We
      // create a local pending placement with a floating action
      // bar (confirm / cancel / delete) so the user can back out
      // of an accidental click. The placement only enters the
      // engine via `onPlace` when the user confirms.
      const root = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - root.left) / cssScale;
      const y = (e.clientY - root.top) / cssScale;
      // Anchor the placement at the click point with the cursor
      // pointing at the rect's top-left corner. The ghost width /
      // height match the live preview so the user sees exactly
      // what they're committing.
      const width = SIGNATURE_GHOST_WIDTH_PT;
      const height = SIGNATURE_GHOST_HEIGHT_PT;
      const rect = clampPlacementToPage(
        { x, y, width, height },
        pageWidthPt,
        pageHeightPt,
      );
      e.preventDefault();
      setPendingPlacement({ signatureId: armedSignatureId, rect });
      setGhostPt(null);
    },
    [armedSignatureId, cssScale, pageWidthPt, pageHeightPt],
  );

  // Bug 2 — pending placement confirm / cancel / delete. The
  // confirm handler routes the placement through the existing
  // `onPlace` callback (same path the engine consumes), so the
  // undo stack and modified flag behave exactly as if the user
  // had committed directly. Cancel/Delete just drop the pending
  // placement without touching the engine.
  const onConfirmPending = useCallback((): void => {
    if (pendingPlacement === null) return;
    onPlace(pendingPlacement.signatureId, pendingPlacement.rect);
    setPendingPlacement(null);
  }, [pendingPlacement, onPlace]);

  const onCancelPending = useCallback((): void => {
    setPendingPlacement(null);
  }, []);

  const interactive = armedSignatureId !== null || pagePlacements.length > 0;
  const armedSig = armedSignatureId !== null ? signatures[armedSignatureId] : undefined;

  // Bug 11 — ghost preview rect. Anchored at the cursor's
  // page-space position (top-left = ghostPt). Width / height
  // match SIGNATURE_GHOST_WIDTH/HEIGHT so the preview is exactly
  // the same size as the placement a click would create.
  const ghostRect =
    armedSignatureId !== null && ghostPt !== null
      ? clampPlacementToPage(
          {
            x: ghostPt.x,
            y: ghostPt.y,
            width: SIGNATURE_GHOST_WIDTH_PT,
            height: SIGNATURE_GHOST_HEIGHT_PT,
          },
          pageWidthPt,
          pageHeightPt,
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={interactive ? "signatures-layer signatures-layer-active" : "signatures-layer"}
      data-page={page}
      data-armed={armedSignatureId !== null ? "true" : "false"}
      onPointerDown={onGhostClick}
    >
      {/* Bug 11 — ghost preview. A translucent rectangle that
          follows the cursor while the signature tool is armed.
          Rendered behind the actual placements so the live raster
          (when present) sits on top. */}
      {ghostRect !== null && (
        <div
          className="sig-ghost"
          data-sig-ghost
          style={{
            position: "absolute",
            left: ghostRect.x * cssScale,
            top: ghostRect.y * cssScale,
            width: ghostRect.width * cssScale,
            height: ghostRect.height * cssScale,
            pointerEvents: "none",
          }}
          aria-hidden
        >
          <SignatureRaster
            signature={armedSig ?? null}
            rect={ghostRect}
            cssScale={cssScale}
          />
        </div>
      )}

      {/* Bug 2 — pending placement. Rendered with a translucent
          body + an action bar above the rect. The action bar's
          confirm / cancel / delete buttons route through the same
          `onPlace` / local-state handlers the overlay already
          uses. */}
      {pendingPlacement !== null && (
        <PendingPlacementView
          rect={pendingPlacement.rect}
          signature={signatures[pendingPlacement.signatureId] ?? null}
          cssScale={cssScale}
          onConfirm={onConfirmPending}
          onCancel={onCancelPending}
        />
      )}

      {pagePlacements.map((p) => {
        const sig = signatures[p.signatureId];
        return (
          <SignaturePlacementView
            key={p.id}
            placement={p}
            signature={sig}
            cssScale={cssScale}
            selected={selectedId === p.id}
            onPointerDown={(e, h): void => onPointerDownPlacement(e, p, h)}
            onPointerMove={onPointerMovePlacement}
            onPointerUp={(e): void => onPointerUpPlacement(e, p)}
            onSelect={(): void => setSelectedId(p.id)}
          />
        );
      })}
    </div>
  );
}

interface PendingPlacementViewProps {
  rect: SignaturePlacement["rect"];
  signature: SavedSignature | null;
  cssScale: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Bug 2 — pending placement view. Renders the in-flight
 *  signature raster at a translucent opacity + a floating action
 *  bar (Confirm / Cancel / Delete) anchored above the rect so the
 *  user can decide whether to keep or discard the placement before
 *  it enters the engine. */
function PendingPlacementView(props: PendingPlacementViewProps): ReactElement {
  const { rect, signature, cssScale, onConfirm, onCancel } = props;
  const leftPx = rect.x * cssScale;
  const topPx = rect.y * cssScale;
  const widthPx = rect.width * cssScale;
  const heightPx = rect.height * cssScale;
  // Anchor the action bar above the rect. If there isn't enough
  // room above (top of page), flip it below the rect.
  const ACTION_BAR_HEIGHT_PX = 32;
  const useAbove = topPx >= ACTION_BAR_HEIGHT_PX + 4;
  const actionBarTopCss = useAbove
    ? topPx - ACTION_BAR_HEIGHT_PX - 4
    : topPx + heightPx + 4;
  return (
    <div
      className="sig-pending"
      data-sig-pending
      style={{ position: "absolute", left: leftPx, top: topPx, width: widthPx, height: heightPx, pointerEvents: "auto" }}
    >
      <SignatureRaster
        signature={signature}
        rect={rect}
        cssScale={cssScale}
      />
      <div
        className="sig-action-bar"
        data-sig-action-bar
        style={{
          position: "absolute",
          left: 0,
          top: actionBarTopCss - topPx,
          // Bar width is clamped to the rect width but grows if
          // the user has a long label.
          minWidth: 200,
          pointerEvents: "auto",
        }}
      >
        <button
          type="button"
          className="sig-action-btn sig-action-btn-confirm"
          onClick={onConfirm}
          data-sig-action="confirm"
          aria-label="Confirm signature placement"
          title="Confirm placement"
        >
          Confirm
        </button>
        <button
          type="button"
          className="sig-action-btn sig-action-btn-cancel"
          onClick={onCancel}
          data-sig-action="cancel"
          aria-label="Cancel signature placement"
          title="Cancel (Esc)"
        >
          Cancel
        </button>
        <button
          type="button"
          className="sig-action-btn sig-action-btn-delete"
          onClick={onCancel}
          data-sig-action="delete"
          aria-label="Discard signature placement"
          title="Discard"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

interface SignaturePlacementViewProps {
  placement: SignaturePlacement;
  signature: SavedSignature | undefined;
  cssScale: number;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, handle?: "nw" | "ne" | "sw" | "se") => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onSelect: () => void;
}

function SignaturePlacementView(props: SignaturePlacementViewProps): ReactElement | null {
  const { placement, signature, cssScale, selected, onPointerDown, onPointerMove, onPointerUp, onSelect } = props;
  const style: CSSProperties = {
    position: "absolute",
    left: placement.rect.x * cssScale,
    top: placement.rect.y * cssScale,
    width: placement.rect.width * cssScale,
    height: placement.rect.height * cssScale,
    pointerEvents: "auto",
  };
  if (signature === undefined) return null;
  return (
    <div
      className={selected ? "sig-placement sig-placement-selected" : "sig-placement"}
      data-placement-id={placement.id}
      data-signature-id={placement.signatureId}
      style={style}
      onPointerDown={(e): void => {
        e.stopPropagation();
        onSelect();
        onPointerDown(e);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <SignatureRaster signature={signature} rect={placement.rect} cssScale={cssScale} />
      {selected && (
        <>
          <div className="sig-handle sig-handle-nw" data-handle="nw" onPointerDown={(e) => onPointerDown(e, "nw")} />
          <div className="sig-handle sig-handle-ne" data-handle="ne" onPointerDown={(e) => onPointerDown(e, "ne")} />
          <div className="sig-handle sig-handle-sw" data-handle="sw" onPointerDown={(e) => onPointerDown(e, "sw")} />
          <div className="sig-handle sig-handle-se" data-handle="se" onPointerDown={(e) => onPointerDown(e, "se")} />
        </>
      )}
    </div>
  );
}

// Render the signature's vector source into a fitted <svg>. Drawn sigs
// use polyline points; typed sigs are rendered as a <text> at a fitted
// script-style font. We deliberately avoid canvas here so the SVG is
// DPI-independent and pixel-crisp at any zoom.
function SignatureRaster({
  signature,
  rect,
  cssScale,
}: {
  signature: SavedSignature | null;
  rect: SignaturePlacement["rect"];
  cssScale: number;
}): ReactElement {
  const svgW = rect.width;
  const svgH = rect.height;
  // The ghost state may fire before signatures[armedId] resolves —
  // render an empty rect with a label so the user still sees a
  // placement-shaped preview while the saved signature loads.
  const source = signature?.source ?? null;
  if (source === null) {
    return (
      <svg
        className="sig-raster"
        viewBox={`0 0 ${svgW} ${svgH}`}
        width={svgW * cssScale}
        height={svgH * cssScale}
        aria-hidden
      >
        <rect
          x={0}
          y={0}
          width={svgW}
          height={svgH}
          fill="none"
          stroke={DRAW_PEN_COLOR}
          strokeWidth={0.6}
          strokeDasharray="2 2"
        />
      </svg>
    );
  }
  if (source.kind === "drawn") {
    const sx = svgW / source.width;
    const sy = svgH / source.height;
    return (
      <svg
        className="sig-raster"
        viewBox={`0 0 ${svgW} ${svgH}`}
        width={svgW * cssScale}
        height={svgH * cssScale}
        aria-hidden
      >
        {source.points.map((stroke, i) => {
          if (stroke.length === 0) return null;
          const d = stroke
            .map((p, idx) => `${idx === 0 ? "M" : "L"} ${(p.x * sx).toFixed(2)} ${(p.y * sy).toFixed(2)}`)
            .join(" ");
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={DRAW_PEN_COLOR}
              strokeWidth={DRAW_PEN_WIDTH / Math.min(sx, sy)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
    );
  }
  // Typed signature — render as a fitted <text>. The engine persisted the
  // rendered width/height as a bbox; the renderer scales the font so the
  // text fits the placement rect with a small inset.
  const padding = 4;
  const targetW = svgW - padding * 2;
  const targetH = svgH - padding * 2;
  // Source was rendered at source.width × source.height. We chose a font
  // size that approximately fills that box, so scale accordingly.
  const fontSize = Math.min(targetH, (targetW / Math.max(source.text.length * 0.55, 1)));
  const text = source.text;
  return (
    <svg
      className="sig-raster"
      viewBox={`0 0 ${svgW} ${svgH}`}
      width={svgW * cssScale}
      height={svgH * cssScale}
      aria-hidden
    >
      <text
        x={padding}
        y={svgH - padding}
        fontFamily="'Brush Script MT', 'Lucida Handwriting', 'Apple Chancery', cursive"
        fontSize={fontSize}
        fontStyle="italic"
        fill={DRAW_PEN_COLOR}
      >
        {text}
      </text>
    </svg>
  );
}
